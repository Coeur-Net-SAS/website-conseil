---
title: "Plan de reprise d'activité Kubernetes : sauvegardes automatisées avec Velero et MinIO"
description: "Comment mettre en place un PRA complet sur un cluster Kubernetes avec Velero et un stockage objet MinIO souverain : installation, planification des sauvegardes et procédures de restauration."
publishDate: 2026-04-15
author: "Cabinet conseil"
tags: ["Kubernetes", "Sécurité", "PRA", "Velero", "MinIO"]
---

## Contexte et objectif

Ce Plan de Reprise d'Activité (PRA) décrit comment mettre en place des sauvegardes automatisées et une procédure de restauration fiable pour des workloads Kubernetes, grâce à **Velero** et un serveur de stockage objet **MinIO** auto-hébergé.

L'objectif est de pouvoir rétablir rapidement n'importe quelle application en cas de corruption de données, de suppression accidentelle de namespace ou de perte totale du cluster, en s'appuyant sur des sauvegardes régulières et testées.

Les exemples de cet article utilisent BookStack, SonarQube, Vaultwarden et Dashy comme applications cibles, mais la démarche s'applique à n'importe quel workload Kubernetes avec des volumes persistants.

## Architecture déployée

- **Velero**
  - Rôle : orchestration des sauvegardes (manifests Kubernetes + volumes persistants)
  - Namespace : `velero`
  - Uploader : Kopia (sauvegardes incrémentales des volumes via CSI)
- **MinIO**
  - Rôle : serveur de stockage objet S3-compatible, cible des sauvegardes Velero
  - Hébergement : machine distincte (`ip-minio:9000`), isolée du cluster sauvegardé
  - Bucket : `backup-cluster` (à adapter selon votre contexte)
- **Plugin Velero pour AWS/S3**
  - Rôle : assure la compatibilité entre Velero et le protocole S3 de MinIO

> **Isolation obligatoire :** MinIO doit impérativement tourner sur une machine indépendante du cluster. Si MinIO est hébergé dans le cluster sauvegardé, une panne globale anéantirait simultanément les workloads et leurs sauvegardes.

## Stratégie de sauvegarde

La stratégie dépend de la criticité de chaque application. Voici un exemple de politique à adapter selon vos besoins :

| Type                                              | Fréquence    | Heure suggérée  | Rétention recommandée |
| ------------------------------------------------- | ------------ | --------------- | --------------------- |
| Applications critiques (données métier)           | Quotidienne  | 2h à 5h         | 7 jours               |
| Applications secondaires (tableaux de bord, etc.) | Hebdomadaire | 4h (dimanche)   | 30 jours              |
| Cluster complet (tous les namespaces applicatifs) | Hebdomadaire | 1h (dimanche)   | 30 jours              |

Chaque backup contient les ressources Kubernetes (Deployments, Services, Secrets, PVC, etc.) ainsi que les snapshots des volumes via le plugin CSI. Kopia assure une sauvegarde incrémentale dans le bucket MinIO.

**Backup hors site :** prévoir une copie mensuelle des sauvegardes MinIO vers un stockage tiers (OneDrive, S3, NAS distant, etc.), afin de garantir la disponibilité des données même en cas de perte complète du serveur MinIO.

## Etapes d'installation

## 01 - Préparer le fichier de credentials MinIO

Velero s'authentifie auprès de MinIO via un fichier de credentials au format AWS. Ce fichier doit être conservé en lieu sûr et ne jamais être versionné en clair dans Git. Le stocker dans un gestionnaire de secrets ou un coffre-fort.

```ini
# credentials-velero
[default]
aws_access_key_id=votre-access-key-minio
aws_secret_access_key=votre-secret-key-minio
```

Pour générer des credentials MinIO, se connecter à l'interface MinIO (`http://ip-minio:9001`) puis : **Identity → Service Accounts → Create service account**.

## 02 - Préparer le fichier de configuration Velero

Le fichier `velero-values.yaml` configure le chart Helm de Velero. Il indique à Velero où stocker les sauvegardes, quel uploader utiliser pour les volumes (Kopia) et quel plugin charger pour la compatibilité S3.

```yaml
# velero-values.yaml
configuration:
  features: EnableCSI
  uploaderType: kopia           # Velero utilise Kopia pour les snapshots de volumes (sauvegardes incrémentales)
  backupStorageLocation:
    - bucket: backup-cluster    # Nom du bucket MinIO cible (à créer au préalable dans l'interface MinIO)
      defaultVolumesToFsBackup: False
      provider: aws
      config:
        region: minio
        s3ForcePathStyle: true  # Requis pour tout stockage S3-compatible (MinIO, Ceph, etc.) - pas nécessaire avec AWS S3 natif
        s3Url: http://ip-minio:9000
  volumeSnapshotLocation:
    - provider: aws
      config:
        region: votre-region    # Région du cluster (ex. gra11 pour OVH Gravelines)
initContainers:
  - name: velero-plugin-for-aws
    image: velero/velero-plugin-for-aws:v1.13.0
    imagePullPolicy: IfNotPresent
    volumeMounts:
      - mountPath: /target
        name: plugins
deployNodeAgent: true           # Nécessaire pour la sauvegarde des volumes via Kopia
```

## 03 - Installer Velero

Le script ci-dessous installe le CLI Velero sur la machine cliente, puis déploie Velero dans le cluster via Helm. Les deux fichiers de l'étape précédente (`credentials-velero` et `velero-values.yaml`) doivent se trouver dans le même répertoire au moment de l'exécution.

```bash
#!/bin/bash
set -e

VELERO_VERSION="v1.17.0"
VELERO_NAMESPACE="velero"

# Installation du CLI Velero (ignoré si déjà présent)
if ! command -v velero &> /dev/null; then
    wget https://github.com/vmware-tanzu/velero/releases/download/${VELERO_VERSION}/velero-${VELERO_VERSION}-linux-amd64.tar.gz -O /tmp/velero.tar.gz
    tar -xzf /tmp/velero.tar.gz -C /tmp
    sudo mv /tmp/velero-${VELERO_VERSION}-linux-amd64/velero /usr/local/bin/
    rm -rf /tmp/velero*
fi

# Déploiement via Helm dans le cluster
helm repo add vmware-tanzu https://vmware-tanzu.github.io/helm-charts
helm repo update

helm upgrade --install velero vmware-tanzu/velero \
  --create-namespace \
  --namespace ${VELERO_NAMESPACE} \
  --set-file credentials.secretContents.cloud=credentials-velero \
  -f velero-values.yaml

# Vérification
kubectl get pods -n ${VELERO_NAMESPACE}
```

Une fois le déploiement terminé, vérifier que la connexion au bucket MinIO est établie (le statut doit être `Available`) :

```bash
velero backup-location get
```

## 04 - Planifier les sauvegardes automatiques

On crée les schedules de sauvegarde pour chaque namespace applicatif. Le flag `--snapshot-move-data` indique à Velero de déplacer les données du snapshot de volume vers MinIO via Kopia, indispensable pour une portabilité complète des sauvegardes.

Le script ci-dessous est un exemple avec quatre applications ; adapter les noms de namespaces, horaires et durées de rétention à votre contexte.

```bash
#!/bin/bash

# Applications critiques - sauvegarde quotidienne, rétention 7 jours (168h)
# Espacer les horaires pour éviter la surcharge simultanée du cluster et du réseau

velero schedule create backup-bookstack-daily \
  --schedule="0 2 * * *" \
  --ttl 168h \
  --include-namespaces bookstack \
  --snapshot-move-data

velero schedule create backup-sonarqube-daily \
  --schedule="0 3 * * *" \
  --ttl 168h \
  --include-namespaces sonar \
  --snapshot-move-data

velero schedule create backup-vaultwarden-daily \
  --schedule="0 5 * * *" \
  --ttl 168h \
  --include-namespaces vault \
  --snapshot-move-data

# Applications secondaires - sauvegarde hebdomadaire, rétention 30 jours (720h)
velero schedule create backup-dashy-weekly \
  --schedule="0 4 * * 0" \
  --ttl 720h \
  --include-namespaces dash \
  --snapshot-move-data

# Backup cluster complet - tous les namespaces applicatifs, rétention 30 jours
velero schedule create backup-cluster-wide \
  --schedule="0 1 * * 0" \
  --ttl 720h \
  --include-namespaces sonar,vault,dash,bookstack
```

Vérifier que les schedules sont bien enregistrés :

```bash
velero schedule get
```

## Procédures de restauration

## Scénario 1 : Incident partiel (une ou plusieurs applications touchées)

Une ou plusieurs applications sont indisponibles ou corrompues, mais le reste du cluster fonctionne normalement. Seule la restauration des namespaces affectés est nécessaire.

**1. Lister les backups disponibles pour identifier le plus récent :**

```bash
velero backup get
```

**2. Restaurer le namespace depuis le backup sélectionné :**

```bash
velero restore create \
  --from-backup <nom-du-backup> \
  --include-namespaces <namespace> \
  --wait
```

Exemple pour BookStack :

```bash
velero restore create \
  --from-backup bookstack-daily-20251027 \
  --include-namespaces bookstack \
  --wait
```

**3. Vérifier le statut de la restauration :**

```bash
velero restore get
kubectl get all -n <namespace>
kubectl get pvc -n <namespace>
```

Tester ensuite l'application pour confirmer la disponibilité et l'intégrité des données.

## Scénario 2 : Incident majeur / perte totale du cluster

Le cluster est entièrement indisponible ou perdu. Il faut reconstruire l'infrastructure et restaurer toutes les applications.

**1. Déployer un nouveau cluster Kubernetes** identique à l'environnement précédent.

**2. Réinstaller Velero** en utilisant les mêmes fichiers `credentials-velero` et `velero-values.yaml`, pointant vers le même bucket MinIO :

```bash
helm repo add vmware-tanzu https://vmware-tanzu.github.io/helm-charts
helm repo update

helm upgrade --install velero vmware-tanzu/velero \
  --create-namespace \
  --namespace velero \
  --set-file credentials.secretContents.cloud=credentials-velero \
  -f velero-values.yaml
```

**3. Vérifier la connexion au bucket et la disponibilité des backups :**

```bash
velero backup-location get   # doit retourner Available
velero backup get            # doit lister les derniers backups
```

**4. Restaurer les namespaces individuellement :**

```bash
velero restore create --from-backup bookstack-daily-YYYYMMDD --include-namespaces bookstack
velero restore create --from-backup sonar-daily-YYYYMMDD --include-namespaces sonar
velero restore create --from-backup vault-daily-YYYYMMDD --include-namespaces vault
velero restore create --from-backup dash-weekly-YYYYMMDD --include-namespaces dash
```

Ou restaurer depuis le dernier backup cluster complet si disponible :

```bash
velero restore create --from-backup backup-cluster-wide-YYYYMMDD
```

**5. Vérifier le statut de tous les restores et tester les applications :**

```bash
velero restore get
```

## Scénario 3 : Perte du serveur MinIO

Le serveur MinIO est perdu ou corrompu. Les sauvegardes locales sont indisponibles, mais la copie hors site (OneDrive ou équivalent) prend le relais.

**1. Déployer un nouveau serveur MinIO** sur une machine Docker.

**2. Transférer les sauvegardes** depuis le stockage hors site vers le nouveau bucket MinIO.

**3. Vérifier la disponibilité des sauvegardes sur le nouveau MinIO :**

```bash
velero backup-location get
velero backup get
```

La restauration suit ensuite le scénario 1 (incident partiel) ou le scénario 2 (perte totale) selon l'état du cluster.

## Vérifications post-restauration

Après toute restauration, valider les points suivants avant de déclarer les services opérationnels :

- Tous les pods sont en état `Running` sans crash loops : `kubectl get pods -A`
- Les volumes persistants sont correctement attachés : `kubectl get pvc -A`
- Les applications sont accessibles et les données intègres
- Les nouveaux backups planifiés s'exécutent correctement : `velero backup get`

## Bonnes pratiques

- **Tester les restaurations régulièrement.** Une sauvegarde non testée n'est pas une sauvegarde. Planifier des exercices de restauration sur un namespace de test au moins une fois par mois.
- **Conserver `velero-values.yaml` et `credentials-velero`** dans un gestionnaire de secrets ou un coffre-fort, hors du dépôt Git.
- **Espacer les horaires de backup** pour éviter de saturer le réseau et les I/O du cluster simultanément.
- **Copier mensuellement** les sauvegardes MinIO vers un stockage hors site (OneDrive, S3 distant, NAS off-site).
- **Documenter chaque incident et restauration** pour améliorer les procédures au fil du temps.
- **Surveiller régulièrement** l'état des schedules et des backups : `velero schedule get` et `velero backup get`.

En suivant ces étapes, vous pouvez assurer une sauvegarde robuste et fiable de vos applications Kubernetes.