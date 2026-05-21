---
title: "Mettre en place un workflow GitOps avec GitLab self-hosted et FluxCD sur Kubernetes"
description: "Comment automatiser le déploiement continu d'applications Kubernetes en mode GitOps : GitLab auto-hébergé comme source de vérité et FluxCD comme moteur de synchronisation."
publishDate: 2026-05-20
author: "Cabinet conseil"
tags: ["Kubernetes", "GitOps", "FluxCD", "GitLab", "CI/CD"]
---

## Contexte et objectif

Cet article décrit la mise en place d'un workflow GitOps complet sur une infrastructure Kubernetes privée hébergée sur OVH. Le principe du GitOps est simple : **Git devient la source de vérité unique** pour l'état du cluster. Tout changement d'infrastructure ou de configuration passe par une pull request, et un opérateur ici FluxCD  se charge de réconcilier en continu l'état du cluster avec ce qui est décrit dans le dépôt.

Nous utilisons :
- **GitLab CE** auto-hébergé sur Docker 
- **FluxCD** installé dans le cluster Kubernetes, qui surveille le dépôt GitLab et applique les manifests automatiquement

Cette architecture garantit la traçabilité complète des changements, la reproductibilité des environnements et l'absence de toute intervention manuelle (`kubectl apply`) en production.

## Architecture déployée

- **GitLab CE**
  - Image Docker : `gitlab/gitlab-ce:latest`
  - Rôle : Hébergement du dépôt Git contenant tous les manifests Kubernetes
  - Certificat TLS Let's Encrypt pour le domaine interne `git.exemple.io`
- **FluxCD**
  - Déployé dans le namespace `flux-system` du cluster Kubernetes
  - Contrôleurs : `source-controller`, `kustomize-controller`, `helm-controller`, `notification-controller`
  - Connexion au GitLab via HTTPS + token d'accès personnel
- **Kubernetes**
  - Cluster OVH Managed Kubernetes (ou équivalent)
  - Certificat TLS Let's Encrypt pour les services interne du cluster

## Prérequis

- Machine Ubuntu avec Docker installé et connectée au réseau 
- Cluster Kubernetes fonctionnel (OVH Managed Kubernetes ou équivalent)
- `kubectl` installé et connecté au cluster
- Domaine interne (ex. `git.exemple.io`) avec certificat TLS valide (Let's Encrypt)

## Etapes de déploiement

## 01 - Installation de GitLab sur Docker

Pour faciliter la gestion de la configuration, on utilise `docker-compose`. On crée le répertoire de travail puis le fichier de composition :

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker

mkdir /srv && cd /srv
nano docker-compose.yml
```

Contenu du `docker-compose.yml` :

```yaml
version: '3.8'
services:
  gitlab:
    image: gitlab/gitlab-ce:latest
    container_name: gitlab
    hostname: git.exemple.io
    restart: always
    environment:
      GITLAB_OMNIBUS_CONFIG: |
        external_url 'https://git.exemple.io'
        nginx['ssl_certificate'] = "/etc/gitlab/ssl/gitlab.exemple.io.crt"
        nginx['ssl_certificate_key'] = "/etc/gitlab/ssl/gitlab.exemple.io.key"
        nginx['redirect_http_to_https'] = true
        registry['enable'] = false
    ports:
      - "80:80"     
      - "443:443"
    volumes:
      - /srv/gitlab/config:/etc/gitlab
      - /srv/gitlab/logs:/var/log/gitlab
      - /srv/gitlab/data:/var/opt/gitlab
      - /etc/letsencrypt/live/exemple.io/fullchain.pem:/etc/gitlab/ssl/gitlab.exemple.io.crt
      - /etc/letsencrypt/live/exemple.io/privkey.pem:/etc/gitlab/ssl/gitlab.exemple.io.key
```

Points importants :
- GitLab est exposé **uniquement sur une IP dans le VPN**, ce qui permet à FluxCD (dans le cluster Kubernetes connecté au VPN) d'y accéder sans l'exposer à l'internet public.
- Les certificats TLS Let's Encrypt sont montés en lecture seule dans le conteneur.

Démarrage du conteneur :

```bash
docker-compose up -d
```

Attendre que le `health` passe de `starting` à `healthy` (peut prendre 2 à 3 minutes) :

```bash
docker ps   # vérifier la colonne STATUS
```

## 02 - Accéder à GitLab

Ajouter l'enregistrement DNS local sur votre poste de travail. Sous Linux : `/etc/hosts`. Sous Windows, ouvrir un terminal en mode administrateur :

```bash
notepad C:\Windows\System32\drivers\etc\hosts
```

Ajouter la ligne :

```
ip-machine  git.exemple.io
```

Accéder ensuite depuis le navigateur : `https://git.exemple.io`

Identifiants par défaut :
- Nom d'utilisateur : `root`
- Mot de passe : récupéré via la commande suivante (valable uniquement 24 h) :

```bash
sudo docker exec -it gitlab cat /etc/gitlab/initial_root_password
```

> **À faire immédiatement** : changer le mot de passe root et créer un dépôt dédié à l'infrastructure (ex. `infra-exemple`).

## 03 - Installer FluxCD

Installation du CLI Flux sur la machine cliente :

```bash
curl -s https://fluxcd.io/install.sh | sudo bash
flux --version
```

Installation de FluxCD sur le cluster Kubernetes. Cette commande déploie tous les contrôleurs et les CRD nécessaires dans le namespace `flux-system` :

```bash
flux install
```

Vérification que tous les pods sont opérationnels :

```bash
kubectl get pods -n flux-system
```

Sortie attendue :

```
NAME                                       READY   STATUS    RESTARTS   AGE
helm-controller-xxx                        1/1     Running   0          1m
kustomize-controller-xxx                   1/1     Running   0          1m
notification-controller-xxx                1/1     Running   0          1m
source-controller-xxx                      1/1     Running   0          1m
```

## 04 - Configurer CoreDNS pour résoudre le domaine GitLab

FluxCD tourne dans le cluster Kubernetes et doit résoudre `git.exemple.io`. Le DNS public ne connaît pas ce domaine interne : il faut enrichir le **CoreDNS** du cluster.

Éditer la ConfigMap CoreDNS :

```bash
kubectl edit configmap/coredns -n kube-system
```

Ajouter un bloc `hosts` dans la section `Corefile` :

```
hosts {
    ip-machine git.exemple.io
    fallthrough
}
```

CoreDNS recharge sa configuration automatiquement. Sans cet enregistrement, FluxCD échoue silencieusement avec un `i/o timeout` au moment du bootstrap (voir section Problèmes rencontrés).

## 05 - Connecter FluxCD au dépôt GitLab

### Créer un token d'accès GitLab

Depuis l'interface GitLab : **Profil → votre dépôt → Settings → Access Tokens → Add new token**

- Nom : `flux-token` (ou similaire)
- Rôle : `Developer` ou `Owner`
- Permissions : cocher `api` (lecture/écriture complète)

> **Important** : copier immédiatement la valeur du token generé - elle n'est affichée qu'une seule fois.

Exporter le token en variable d'environnement sur la machine cliente :

```bash
export GITLAB_TOKEN="valeur_du_token"
```

### Bootstrap Flux sur le dépôt

La commande `flux bootstrap` initialise la connexion et pousse les manifests de Flux dans le dépôt :

```bash
flux bootstrap gitlab \
  --token-auth \
  --hostname=git.exemple.io \
  --owner=root \
  --repository=infra-exemple \
  --branch=main \
  --path=./clusters
```

Après exécution, Flux a créé un dossier `clusters/` dans le dépôt et commence à surveiller ce chemin. Vérifier la synchronisation initiale :

```bash
flux get kustomizations -n flux-system
```

Sortie attendue (colonne `READY` à `True`) :

```
NAME            REVISION        SUSPENDED  READY   MESSAGE
flux-system     main/abc1234    False      True    Applied revision: main/abc1234
```

## 06 - Structure du dépôt GitOps

Une fois Flux connecté, on organise le dépôt selon une convention de répertoires. Cloner le dépôt sur sa machine :

```bash
git clone https://git.exemple.io/root/infra-exemple.git
```

Structure recommandée pour déployer des applications (exemple avec BookStack) :

```
clusters/
└── my-cluster/
    ├── gotk-components.yaml          # manifests Flux (auto-générés)
    ├── flux-system/
    │   ├── gotk-sync.yaml
    │   ├── kustomization.yaml
    │   └── namespace.yaml
    └── apps/
        ├── ingress-controller/
        │   ├── kustomization.yaml
        │   ├── namespace.yaml
        │   ├── ingress-nginx-controller.yaml
        │   └── admission-ingress-nginx-controller.yaml
        └── bookstack/
            ├── kustomization.yaml
            ├── namespace.yaml
            ├── app/
            │   ├── deployment.yaml
            │   ├── service.yaml
            │   └── ingress.yaml
            └── db/
                ├── deployment.yaml
                ├── service.yaml
                └── persistentvolumeclaim.yaml
```

## 07 - Workflow GitOps au quotidien

Une fois l'infrastructure en place, déployer ou modifier une application ne nécessite plus aucune commande `kubectl apply` directe. Tout passe par Git :

```bash
# Ajouter tous les fichiers du répertoire courant
git add .

# Ou ajouter un fichier spécifique
git add clusters/my-cluster/apps/bookstack/app/deployment.yaml

# Committer le changement
git commit -m "feat: déploiement de BookStack"

# Pousser sur le dépôt distant
git push
```

FluxCD détecte le nouveau commit (intervalle de scrutation par défaut : 1 minute) et applique automatiquement les changements dans le cluster.

### Commandes de supervision utiles

```bash
# Voir l'état de toutes les kustomizations
flux get kustomizations -n flux-system

# Forcer une synchronisation immédiate sans attendre le prochain cycle
flux reconcile kustomization flux-system

# Suivre les logs du kustomize-controller en temps réel
kubectl logs -n flux-system deploy/kustomize-controller -f
```

## Problèmes rencontré et solution

### 1 - i/o timeout lors du bootstrap

Le bootstrap Flux échouait avec l'erreur suivante :

```
Get "https://git.exemple.io/root/infra-exemple.git/info/refs?service=git-upload-pack":
dial tcp ip-machine:443: i/o timeout
```

**Cause :** le CoreDNS du cluster Kubernetes ne connaissait pas le domaine interne `git.exemple.io`. Flux ne pouvait donc pas résoudre l'adresse IP du GitLab.

**Solution :** éditer la ConfigMap CoreDNS et ajouter l'enregistrement `hosts` comme décrit à l'étape 04.

```bash
kubectl edit configmap/coredns -n kube-system
```

```
hosts {
    ip-machine git.exemple.io
    fallthrough
}
```

CoreDNS se recharge automatiquement. Relancer ensuite le bootstrap Flux.
