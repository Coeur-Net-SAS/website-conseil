---
title: "Déploiement multi-environnements sur Kubernetes : dev, staging, prod avec Supabase et FluxCD"
description: "Comment déployer la plateforme Supabase sur trois environnements Kubernetes isolés (dev, staging, prod) via FluxCD et Helm, avec des secrets chiffrés SealedSecret et une machine Linux de maintenance par namespace."
publishDate: 2026-05-20
author: "Cabinet conseil"
tags: ["Kubernetes", "Supabase", "FluxCD", "GitOps", "Multi-environnements"]
---

## Contexte et objectif

Cet article décrit la mise en place d'une stratégie de déploiement multi-environnements sur Kubernetes pour la plateforme **Supabase** (backend as a service open source : base de données PostgreSQL, API REST, authentification, stockage objet, interface studio). Chaque environnement (dev, staging, prod) est isolé dans son propre namespace Kubernetes et géré par **FluxCD** via GitOps.

Un pod Linux de maintenance est déployé dans chaque namespace pour permettre l'accès SSH à la base de données PostgreSQL et faciliter les opérations de diagnostic.

## Architecture déployée

- **Supabase** : plateforme auto-hébergée composée de plusieurs modules (db, studio, auth, rest, realtime, storage, kong, analytics, vector, functions)
- **FluxCD** : opérateur GitOps qui synchronise le cluster avec le dépôt Git via des ressources HelmRelease et Kustomization
- **Helm** : chart communautaire `supabase-kubernetes` pour déployer Supabase
- **SealedSecrets** : chiffrement des secrets Kubernetes pour les stocker en Git en toute sécurité
- **Machine Linux** : pod Ubuntu déployé dans chaque namespace, accessible en SSH via un Service NodePort, connecté à PostgreSQL via des variables d'environnement

Chaque environnement correspond à un namespace distinct :

| Namespace | Studio (Ingress)               | Usage       |
| --------- | ------------------------------ | ----------- |
| dev       | dev-supabase.exemple.io        | Développement |
| stag      | stag-supabase.exemple.io       | Staging     |
| prod      | prod-supabase.exemple.io       | Production  |

## Prérequis

- Un cluster Kubernetes opérationnel avec `kubectl` configuré
- FluxCD installé dans le cluster (`flux` CLI disponible en local)
- Un Ingress Controller déployé (Nginx, Traefik, etc.)
- Une StorageClass disponible pour les volumes persistants
- `helm` installé en local (pour la gestion initiale du chart)
- `kubeseal` installé en local pour chiffrer les secrets
- Un dépôt Git accessible depuis le cluster (GitLab, GitHub, etc.)

## Structure du dépôt Git

Le dépôt Git contient la configuration FluxCD de tous les environnements. L'arborescence recommandée :

```
clusters/
  mon-cluster/
    apps/
      dev/
        supabase/
          helmrelease.yaml
          kustomization.yaml
          values.yaml
          secrets/          # SealedSecrets chiffrés
        linux-machine/
          deployment.yaml
          service.yaml
      stag/
        supabase/
          ...
      prod/
        supabase/
          ...
```

Les `values.yaml` sont injectés en tant que ConfigMap via `configMapGenerator` dans la Kustomization, puis montés dans le HelmRelease.

## Etapes de déploiement : environnement DEV

## 01 - Créer le namespace et les SealedSecrets

Créer le namespace dédié à l'environnement de développement :

```bash
kubectl create namespace dev
```

Supabase nécessite plusieurs secrets pour fonctionner. Chaque secret est créé localement, puis chiffré avec `kubeseal` pour être stocké dans Git. Les secrets sont scopés au namespace `dev` : ils ne peuvent pas être déchiffrés dans un autre namespace.

Les secrets nécessaires :

- **supabase-tls-secret** : certificat TLS wildcard pour l'Ingress
- **supabase-analytics-secret** : clé Logflare pour le module analytics
- **supabase-dashboard-secret** : identifiants de l'interface Studio
- **supabase-db-secret** : identifiants PostgreSQL (utilisateur, mot de passe, nom de base)
- **supabase-jwt-secret** : clé JWT partagée entre les modules auth, rest et realtime
- **supabase-smtp-secret** : configuration SMTP pour les emails d'authentification

Pour chiffrer un secret existant :

```bash
kubectl create secret generic supabase-db-secret \
  --namespace dev \
  --from-literal=username=supabase \
  --from-literal=password=motdepasse \
  --from-literal=database=supabase \
  --dry-run=client -o yaml \
  | kubeseal --format yaml > secrets/supabase-db-secret.yaml
```

Répéter l'opération pour chacun des secrets listés ci-dessus, en adaptant les clés et valeurs à chaque cas. Versionner les fichiers `*-sealed.yaml` résultants dans Git. Ne jamais versionner les secrets en clair.

## 02 - Configurer le fichier values.yaml

Le fichier `values.yaml` configure tous les modules Supabase. Voici les sections essentielles à adapter (le reste peut rester aux valeurs par défaut du chart) :

```yaml
# values.yaml (sections clés)

secret:
  # Références aux secrets Kubernetes créés à l'étape précédente
  db:
    secretRef: supabase-db-secret
    secretRefKey:
      username: username
      password: password
      database: database
  jwt:
    secretRef: supabase-jwt-secret
    secretRefKey:
      anonKey: anonKey
      serviceKey: serviceKey
      secret: secret
  analytics:
    secretRef: supabase-analytics-secret
    secretRefKey:
      apiKey: apiKey
  dashboard:
    secretRef: supabase-dashboard-secret
    secretRefKey:
      username: username
      password: password
  smtp:
    secretRef: supabase-smtp-secret
    secretRefKey:
      username: username
      password: password

db:
  enabled: true
  persistence:
    enabled: true
    storageClass: ""       # Laisser vide pour utiliser la StorageClass par défaut
    size: 8Gi

studio:
  enabled: true
  environment:
    SUPABASE_PUBLIC_URL: https://dev-supabase.exemple.io

auth:
  enabled: true
  environment:
    API_EXTERNAL_URL: https://dev-supabase.exemple.io
    GOTRUE_SITE_URL: https://dev-supabase.exemple.io
    GOTRUE_SMTP_HOST: smtp.exemple.io
    GOTRUE_SMTP_PORT: "587"
    GOTRUE_SMTP_SENDER_NAME: "Dev Supabase"

kong:
  enabled: true
  ingress:
    enabled: true
    className: nginx
    annotations:
      nginx.ingress.kubernetes.io/rewrite-target: /
    tls:
      - hosts:
          - dev-supabase.exemple.io
        secretName: supabase-tls-secret
    hosts:
      - host: dev-supabase.exemple.io
        paths:
          - path: /
            pathType: Prefix

analytics:
  enabled: true

vector:
  enabled: true

functions:
  enabled: true
```

Les modules `rest`, `realtime`, `storage`, et `imgproxy` peuvent être activés avec `enabled: true` et leurs valeurs par défaut pour un environnement de développement.

## 03 - Créer le HelmRelease FluxCD

Le HelmRelease indique à FluxCD quel chart Helm déployer et depuis quelle source de configuration. Le `valuesFrom` monte le ConfigMap généré à partir du `values.yaml` (voir étape suivante) :

```yaml
# helmrelease.yaml
apiVersion: helm.toolkit.fluxcd.io/v2beta1
kind: HelmRelease
metadata:
  name: supabase
  namespace: dev
spec:
  interval: 10m
  chart:
    spec:
      chart: supabase
      version: "0.x"
      sourceRef:
        kind: HelmRepository
        name: supabase
        namespace: flux-system
  valuesFrom:
    - kind: ConfigMap
      name: supabase-values
      valuesKey: values.yaml
```

Le HelmRepository correspondant doit être déclaré dans `flux-system` :

```yaml
# helmrepository.yaml (dans flux-system)
apiVersion: source.toolkit.fluxcd.io/v1beta2
kind: HelmRepository
metadata:
  name: supabase
  namespace: flux-system
spec:
  interval: 1h
  url: https://supabase-community.github.io/supabase-kubernetes
```

## 04 - Créer la Kustomization avec configMapGenerator

La Kustomization FluxCD orchestre le déploiement : elle applique les SealedSecrets et génère automatiquement un ConfigMap à partir du `values.yaml` local, évitant ainsi de dupliquer les valeurs dans plusieurs ressources :

```yaml
# kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - helmrelease.yaml
  - secrets/supabase-tls-secret.yaml
  - secrets/supabase-analytics-secret.yaml
  - secrets/supabase-dashboard-secret.yaml
  - secrets/supabase-db-secret.yaml
  - secrets/supabase-jwt-secret.yaml
  - secrets/supabase-smtp-secret.yaml
configMapGenerator:
  - name: supabase-values
    files:
      - values.yaml=values.yaml
```

Le `configMapGenerator` crée automatiquement un ConfigMap nommé `supabase-values` contenant le fichier `values.yaml`. Ce ConfigMap est ensuite référencé dans le HelmRelease via `valuesFrom`.

## 05 - Déployer la machine Linux de maintenance

Un pod Ubuntu est déployé dans le namespace `dev` pour permettre l'accès SSH et les opérations de maintenance sur la base de données. Les identifiants PostgreSQL sont injectés depuis le secret `supabase-db-secret`.

```yaml
# linux-machine/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: linux-machine
  namespace: dev
spec:
  replicas: 1
  selector:
    matchLabels:
      app: linux-machine
  template:
    metadata:
      labels:
        app: linux-machine
    spec:
      containers:
        - name: ubuntu
          image: ubuntu:22.04
          command: ["/bin/bash", "-c"]
          args:
            - |
              apt-get update && apt-get install -y openssh-server sudo postgresql-client &&
              useradd -m -s /bin/bash dev && echo "dev ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers &&
              mkdir -p /home/dev/.ssh && chmod 700 /home/dev/.ssh &&
              echo "$AUTHORIZED_KEYS" > /home/dev/.ssh/authorized_keys &&
              chmod 600 /home/dev/.ssh/authorized_keys && chown -R dev:dev /home/dev/.ssh &&
              mkdir -p /run/sshd && /usr/sbin/sshd -D
          env:
            - name: AUTHORIZED_KEYS
              valueFrom:
                secretKeyRef:
                  name: supabase-db-secret
                  key: authorizedKeys
            - name: PGHOST
              value: supabase-db.dev.svc.cluster.local
            - name: PGUSER
              valueFrom:
                secretKeyRef:
                  name: supabase-db-secret
                  key: username
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: supabase-db-secret
                  key: password
            - name: PGDATABASE
              valueFrom:
                secretKeyRef:
                  name: supabase-db-secret
                  key: database
```

```yaml
# linux-machine/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: linux-machine-ssh
  namespace: dev
spec:
  type: NodePort
  selector:
    app: linux-machine
  ports:
    - port: 22
      targetPort: 22
```

Pour se connecter en SSH, récupérer le NodePort attribué automatiquement :

```bash
kubectl get svc linux-machine-ssh -n dev
# NAME                TYPE       CLUSTER-IP   EXTERNAL-IP   PORT(S)        AGE
# linux-machine-ssh   NodePort   10.96.x.x    <none>        22:3xxxx/TCP   1m

ssh dev@ip-ingress -p 3xxxx
```

Remplacer `ip-ingress` par l'adresse IP de l'un des noeuds du cluster ou de l'Ingress Controller, et `3xxxx` par le port NodePort affiché.

## 06 - Appliquer la configuration via FluxCD

Pousser les fichiers dans le dépôt Git. FluxCD détecte automatiquement les changements et synchronise le cluster. Pour forcer une reconciliation immédiate :

```bash
# Vérifier l'état des Kustomizations
flux get kustomization

# Forcer la reconciliation
flux reconcile kustomization supabase-dev --with-source

# Vérifier l'état du HelmRelease
flux get helmrelease -n dev

# Forcer la reconciliation du HelmRelease
flux reconcile helmrelease supabase -n dev
```

Une fois déployé, l'interface Studio est accessible à `https://dev-supabase.exemple.io` avec les identifiants définis dans `supabase-dashboard-secret`.

## Déploiement STAGING

L'environnement staging est identique à l'environnement dev. Seuls les éléments suivants changent.

**Namespace :** `stag`

**Hostname dans values.yaml :**

```yaml
studio:
  environment:
    SUPABASE_PUBLIC_URL: https://stag-supabase.exemple.io

auth:
  environment:
    API_EXTERNAL_URL: https://stag-supabase.exemple.io
    GOTRUE_SITE_URL: https://stag-supabase.exemple.io

kong:
  ingress:
    tls:
      - hosts:
          - stag-supabase.exemple.io
        secretName: supabase-tls-secret
    hosts:
      - host: stag-supabase.exemple.io
```

**Secrets :** générer et chiffrer un nouveau jeu de secrets pour le namespace `stag`. Les SealedSecrets étant scopés au namespace, les secrets du namespace `dev` ne sont pas réutilisables. Répéter l'étape 01 en remplaçant `--namespace dev` par `--namespace stag`.

**Structure Git :** dupliquer le répertoire `apps/dev/` en `apps/stag/` et adapter les fichiers comme décrit ci-dessus.

## Déploiement PROD

Même principe que staging. Les changements à effectuer par rapport à dev :

**Namespace :** `prod`

**Hostname :** `prod-supabase.exemple.io` (dans les mêmes champs que staging)

**Persistence PostgreSQL :** augmenter la taille du volume selon les besoins :

```yaml
db:
  persistence:
    size: 20Gi    # Adapter selon le volume de données attendu
```

**Secrets :** nouveau jeu de secrets scopés `--namespace prod`, avec des mots de passe distincts de dev et staging.

**Structure Git :** dupliquer `apps/dev/` en `apps/prod/` et adapter.

## Vérifications post-déploiement

Après chaque déploiement, vérifier que tous les pods sont opérationnels :

```bash
kubectl get pods -n dev       # ou stag, prod
kubectl get pvc -n dev
kubectl get ingress -n dev
```

Vérifier que FluxCD ne signale pas d'erreur :

```bash
flux get kustomization
flux get helmrelease -n dev
```

Tester l'accès à l'interface Studio via le navigateur, puis la connexion SSH à la machine Linux pour confirmer l'accès à PostgreSQL :

```bash
# Depuis la machine Linux (après connexion SSH)
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "\dt"
```

## Bonnes pratiques

- **Utiliser des mots de passe distincts par environnement.** Un secret compromis en dev ne doit pas affecter la production.
- **Tester les migrations sur dev et staging avant prod.** La machine Linux de maintenance permet de se connecter à PostgreSQL et de valider les scripts SQL avant déploiement.
- **Ne jamais versionner de secrets en clair.** Seuls les SealedSecrets chiffrés (fichiers `*-sealed.yaml`) sont versionnés dans Git.
- **Superviser les reconciliations FluxCD.** Un `flux get kustomization` périodique ou une alerte sur les erreurs de reconciliation permet de détecter rapidement un désynchronisation.
- **Prévoir des sauvegardes des volumes PostgreSQL.** Intégrer Velero pour les environnements staging et prod (voir l'article sur le PRA Kubernetes).
