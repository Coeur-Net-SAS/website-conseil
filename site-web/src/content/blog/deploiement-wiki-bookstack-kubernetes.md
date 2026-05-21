---
title: "Deployer un wiki d'entreprise interne sur kubernetes avec Bookstack"
description: "Comment déployer un wiki collaboratif open source sur un cluster Kubernetes privé pour centraliser la documentation interne, sans dépendance à un SaaS tiers."
publishDate: 2026-05-20
author: "Cabinet conseil"
tags: ["Kubernetes", "Souveraineté", "Wiki", "BookStack"]
---

## Contexte et objectif

Cet article décrit le déploiement de BookStack, une application open source de gestion collaborative de documentation, sur un cluster Kubernetes privé hébergé sur infrastructure OVH. BookStack permet de centraliser toute la documentation interne (procédures, runbooks, knowledge base) sur une plateforme maîtrisée, sans dépendance à un service SaaS tiers.

## Architecture déployée

- **bookstack**
  - Image Docker : `linuxserver/bookstack`
  - Rôle : Application principale (wiki collaboratif)
- **mariadb**
  - Image Docker : `mariadb:latest`
  - Rôle : Base de données relationnelle pour stocker pages, livres et utilisateurs
- **bookstack-pvc** : Stockage persistant des fichiers BookStack
- **mariadb-pvc** : Stockage persistant MariaDB
- **NGINX Ingress Controller** : Point d'entrée HTTP/HTTPS depuis l'extérieur
- **Network Policy** : Restriction de la communication aux pods internes et au réseau privé

## Prérequis

- Infrastructure : cluster Kubernetes déployé sur fournisseur de cloud (infrastructure privée)
- `kubectl` (Client v1.32.0, Kustomize v5.5.0)
- NGINX Ingress Controller
- BDD : MariaDB
- Domaine : `bookstack.exemple.io` (à sauvegarder dans `/etc/hosts` avec l'IP de l'ingress pour un test local)

## Etapes de déploiement

## 00 - Namespace
Pour une bonne organisation nous allons créer un namespace dédié dans lequel nous allons déployer notre application. Cela permet d'isoler les ressources et les configurations spécifiques à BookStack.

- Commande directe : `kubectl create namespace bookstack`
- Ou via un manifest YAML :

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: bookstack
```

Ensuite : `kubectl apply -f namespace.yaml` pour l'appliquer.

## 01 - PVC MariaDB
Afin de rendre les données de la base persistantes au redémarrage d'un pod, il faut créer un PersistentVolumeClaim. On alloue ici 10Gi sur la storageClass `csi-cinder-classic`.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mariadb-pvc
  namespace: bookstack
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: csi-cinder-classic
```

Pour déterminer votre `storageClassName`, exécutez : `kubectl get storageclass`.
Ensuite : `kubectl apply -f mariadb-pvc.yaml`.

## 02 - Secrets MariaDB
Afin de sécuriser notre déploiement, nous devons créer un secret pour stocker les informations sensibles (mot de passe root, utilisateur applicatif, mot de passe applicatif). Toutes les valeurs sont encodées en base64.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: mariadb-secrets
  namespace: bookstack
type: Opaque
data:
  MYSQL_ROOT_PASSWORD: # votre mdp root encodé : echo -n "root" | base64
  MYSQL_PASSWORD:      # votre mdp applicatif encodé : echo -n "bookpass" | base64
  MYSQL_USER:          # votre user encodé : echo -n "bookuser" | base64
```

Ensuite : `kubectl apply -f mariadb-secrets.yaml`.

## 03 - Déploiement de MariaDB
On déploie maintenant une instance MariaDB qui va stocker tout l'état de BookStack (pages, livres, utilisateurs, permissions). On monte le PVC créé à l'étape 01 et on injecte les variables d'environnement depuis le secret.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mariadb
  namespace: bookstack
  labels:
    app: mariadb
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mariadb
  template:
    metadata:
      labels:
        app: mariadb
    spec:
      containers:
        - name: mariadb
          image: mariadb:latest
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mariadb-secrets
                  key: MYSQL_ROOT_PASSWORD
            - name: MYSQL_DATABASE
              value: "bookstack"
            - name: MYSQL_USER
              valueFrom:
                secretKeyRef:
                  name: mariadb-secrets
                  key: MYSQL_USER
            - name: MYSQL_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mariadb-secrets
                  key: MYSQL_PASSWORD
          ports:
            - containerPort: 3306
          volumeMounts:
            - name: mariadb-storage
              mountPath: /var/lib/mysql
      volumes:
        - name: mariadb-storage
          persistentVolumeClaim:
            claimName: mariadb-pvc
```

Ensuite : `kubectl apply -f mariadb-deployment.yaml`.

## 04 - Service MariaDB
Pour que BookStack puisse contacter l'instance MariaDB déployée ci-dessus, il faut un service associé. On choisit `ClusterIP` car la base n'a pas vocation à être exposée à l'extérieur du cluster.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mariadb
  namespace: bookstack
  labels:
    app: mariadb
spec:
  ports:
    - port: 3306
      targetPort: 3306
  selector:
    app: mariadb
  type: ClusterIP
```

Ensuite : `kubectl apply -f mariadb-svc.yaml`.

## 05 - PVC BookStack
BookStack stocke ses fichiers de configuration et ses uploads dans `/config`. On alloue 10Gi sur le même type de storage.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bookstack-pvc
  namespace: bookstack
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: csi-cinder-classic
```

Ensuite : `kubectl apply -f bookstack-pvc.yaml`.

## 06 - Secrets BookStack
BookStack a besoin de trois valeurs sensibles : la `APP_KEY` (clé d'application Laravel, indispensable pour le chiffrement des sessions), et les identifiants de connexion à MariaDB. Toutes encodées en base64.

> **Important :** la `APP_KEY` doit être une clé Laravel valide, sinon le serveur renverra une erreur 500. On peut en générer une sur [generate-random.org/laravel-key-generator](https://generate-random.org/laravel-key-generator) puis l'encoder en base64.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: bookstack-secrets
  namespace: bookstack
type: Opaque
data:
  APP_KEY:     # clé Laravel encodée en base64
  DB_PASSWORD: # même valeur que MYSQL_PASSWORD côté MariaDB
  DB_USERNAME: # même valeur que MYSQL_USER côté MariaDB
```

Ensuite : `kubectl apply -f bookstack-secrets.yaml`.

## 07 - Déploiement de BookStack
Nous allons à présent déployer l'instance de BookStack via l'image officielle `linuxserver/bookstack`. On monte le PVC et on injecte les variables d'environnement (URL publique, clé d'app, paramètres DB) depuis le secret.

> **À noter :** `APP_URL` est primordial. Cette valeur doit correspondre exactement à l'URL par laquelle on accède au serveur. Si le port n'est pas standard, le préciser (ex. `http://bookstack.exemple.io:8080`).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bookstack
  namespace: bookstack
  labels:
    app: bookstack
spec:
  replicas: 1
  selector:
    matchLabels:
      app: bookstack
  template:
    metadata:
      labels:
        app: bookstack
    spec:
      containers:
        - name: bookstack
          image: linuxserver/bookstack
          securityContext:
            runAsUser: 0
          ports:
            - containerPort: 80
          env:
            - name: APP_URL
              value: "https://bookstack.exemple.io"
            - name: APP_KEY
              valueFrom:
                secretKeyRef:
                  name: bookstack-secrets
                  key: APP_KEY
            - name: DB_HOST
              value: "mariadb"
            - name: DB_DATABASE
              value: "bookstack"
            - name: DB_USERNAME
              valueFrom:
                secretKeyRef:
                  name: bookstack-secrets
                  key: DB_USERNAME
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: bookstack-secrets
                  key: DB_PASSWORD
          volumeMounts:
            - name: bookstack-data
              mountPath: /config
      volumes:
        - name: bookstack-data
          persistentVolumeClaim:
            claimName: bookstack-pvc
```

Ensuite : `kubectl apply -f bookstack-deployment.yaml`.

## 08 - Service BookStack
Pour permettre les accès dans le cluster à ce pod, on met un service associé. On choisit `ClusterIP` car le cluster se trouve derrière un Ingress Controller, ce qui permet de centraliser l'accès externe via l'Ingress et de garder les services internes non exposés directement.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: bookstack-service
  namespace: bookstack
spec:
  type: ClusterIP
  selector:
    app: bookstack
  ports:
    - port: 80
      targetPort: 80
```

Ensuite : `kubectl apply -f bookstack-svc.yaml`.

À ce stade, un `kubectl get pvc,svc,pod,secrets -n bookstack` doit retourner les deux PVC `Bound`, les deux services `ClusterIP`, les deux pods `Running` et les secrets en place.

## 09 - Ingress

Pour utiliser un ingress pour notre application il nous faut d'abord un ingress-controller. Nous choisissons NGINX :

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.1/deploy/static/provider/cloud/deploy.yaml
```

Une fois les pods et services de l'ingress-controller en `Running` (namespace `ingress-nginx`), on peut déployer l'ingress pour notre app. Pour la section TLS, nous utiliserons un certificat Let's Encrypt stocké en secret (voir la partie Sécurité plus bas).

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: bookstack-ingress
  namespace: bookstack
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "0"   # Autorise les gros fichiers (uploads)
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - bookstack.exemple.io
      secretName: bookstack-tls-secret
  rules:
    - host: bookstack.exemple.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: bookstack-service
                port:
                  number: 80
```

Ensuite : `kubectl apply -f bookstack-ingress.yaml`.

Après déploiement, la commande `kubectl get ingress -n bookstack` doit renvoyer l'ingress avec un host `bookstack.coeur-net.io` et une `ADDRESS` correspondant à l'IP de l'ingress-controller.

## Accès à l'application

Pour acceder à l'application BookStack, il faut d'abord ajouter un DNS (ex : /etc/hosts) pointant vers l'adresse IP de l'ingress-controller.

Ouvrir ensuite `https://bookstack.exemple.io`. Les identifiants par défaut sont :
- email : `admin@admin.com`
- mot de passe : `password`

**À changer immédiatement après la première connexion.**

## Sécurité

### Chiffrement des secrets avec kubeseal
Encoder les valeurs sensibles en base64 ne suffit pas, surtout si on pousse les manifests dans un dépôt Git (l'encodage base64 n'est pas du chiffrement). On met en place le chiffrement avec **kubeseal** :

```bash
# Installation
sudo apt-get install -y kubeseal

# Récupération de la clé publique du contrôleur
kubeseal --fetch-cert > mycert.pem

# Chiffrement d'un secret existant
kubectl get secret my-secret -o yaml | kubeseal --cert mycert.pem -o yaml > my-sealed-secret.yaml
```

Ensuite : `kubectl apply -f my-sealed-secret.yaml`.

> **Pour une architecture GitOps**, il faut pousser **uniquement** les secrets chiffrés (SealedSecrets) et jamais les secrets en clair dans le dépôt.

### Load balancer privé pour l'ingress-controller
Sur le service de l'ingress-controller, on a édité le fichier et rajouté une annotation pour que le load balancer n'expose l'ingress que sur une IP appartenant au réseau privé .

```yaml
service.beta.kubernetes.io/openstack-internal-load-balancer: "true"
```

### Network Policy
Mise en place d'une politique réseau pour restreindre l'accès à l'application BookStack et à toutes les futures apps de l'infra privée. Seuls les utilisateurs du réseau `ip-reseau/masque` pourront y accéder.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-internal-and-private-network
  namespace: bookstack
spec:
  podSelector: {}   # sur tous les pods
  ingress:
    - from:
        - namespaceSelector: {}
          podSelector: {}
    - from:
        - ipBlock:
            cidr: 10.0.0.0/8
```

### Secret TLS
Création d'un secret TLS pour sécuriser l'accès à BookStack via HTTPS.
`kubectl create secret tls bookstack-tls --key /chemin/vers/cle.key --cert /chemin/vers/cert.crt`

> **GitOps :** ne pas oublier de chiffrer ce secret TLS avec kubeseal avant tout push.

## Problèmes rencontrés et solutions

### 1 - Internal Server Error (500)
Juste après avoir déployé BookStack (avant l'ingress, avec un service de type LoadBalancer), un accès à l'IP publique générée renvoyait un **500 Internal Server Error**. Erreur générique côté Laravel : le serveur a rencontré un problème mais ne précise pas lequel.

**Cause :** la `APP_KEY` était mal générée et donc invalide.

**Solution :** régénérer une clé Laravel valide sur [generate-random.org/laravel-key-generator](https://generate-random.org/laravel-key-generator), l'encoder en base64, et la remettre dans le secret `bookstack-secrets`.

### 2 - APP_URL
Toujours s'assurer que la valeur de `APP_URL` correspond exactement à l'adresse par laquelle on accède au serveur BookStack. S'il y a un port non standard, le préciser : `http://ip_serveur:port`. Sinon, les liens internes générés par BookStack (CSRF, redirections après login, etc.) seront cassés.