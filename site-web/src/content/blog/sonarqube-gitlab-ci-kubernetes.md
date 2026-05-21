---
title: "Déployer SonarQube sur Kubernetes via GitOps et l'intégrer à GitLab CI"
description: "Comment mettre en place une plateforme d'analyse de qualité de code avec SonarQube sur Kubernetes, et l'intégrer à GitLab CI/CD pour une analyse automatique à chaque pipeline."
publishDate: 2026-05-20
author: "Cabinet conseil"
tags: ["Kubernetes", "SonarQube", "GitLab", "CI/CD", "Qualité de code"]
---

## Contexte et objectif

Cet article décrit le déploiement de SonarQube sur un cluster Kubernetes en mode GitOps (via FluxCD), puis son intégration à un pipeline GitLab CI/CD pour analyser automatiquement la qualité du code à chaque push. SonarQube détecte bugs, vulnérabilités, dette technique et mauvaises pratiques directement dans le pipeline, sans aucune dépendance à un service SaaS tiers.

## Architecture déployée

- **sonarqube**
  - Image Docker : `sonarqube:latest`
  - Rôle : plateforme d'analyse statique de code
  - Port : `9000`
- **postgres** (bitnami)
  - Image Docker : `bitnami/postgresql`
  - Rôle : base de données de SonarQube (projets, résultats d'analyse, utilisateurs)
- **postgres-pvc / sonar-pvc** : stockage persistant sur NFS (`nfs-csi`)
- **NGINX Ingress** : point d'entrée HTTPS avec certificat Let's Encrypt
- **FluxCD** : synchronisation GitOps des manifests depuis le dépôt GitLab

> **Sécurité GitOps :** tous les secrets doivent être chiffrés avec **kubeseal** avant tout push sur le dépôt Git. Ne jamais pousser de secrets en clair, même encodés en base64.

## Etapes de déploiement

## 00 - Namespace

Nous créons un namespace dédié `sonar` pour isoler toutes les ressources de SonarQube (pods, services, secrets, PVC) du reste du cluster. Cela facilite la gestion des permissions et le nettoyage éventuel.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: sonar
```

```bash
kubectl apply -f namespace.yaml
```

## 01 - Déploiement de PostgreSQL

SonarQube nécessite une base de données relationnelle pour stocker ses données (projets, résultats d'analyse, utilisateurs, règles). Nous déployons une instance PostgreSQL Bitnami dans le même namespace.

### PersistentVolumeClaim

Le PVC garantit la persistance des données de PostgreSQL entre les redémarrages de pods. Nous allouons 10 Gi sur la classe de stockage `nfs-csi`. Pour connaître les classes disponibles dans votre cluster : `kubectl get storageclass`.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: sonar
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: nfs-csi
```

### Secret

Le secret contient les identifiants de connexion à la base de données (nom de la BDD, utilisateur, mot de passe). Les valeurs sont encodées en base64. **Attention :** l'encodage base64 n'est pas du chiffrement . Il faut impérativement chiffrer ce secret avec kubeseal avant tout push sur Git.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
  namespace: sonar
data:
  database: c29uYXJfZGI=   # sonar_db
  username: c29uYXJfdXNlcg== # sonar_user
  password: c29uYXJfcGFzcw== # sonar_pass
```

### Deployment

Le Deployment décrit comment créer et gérer le pod PostgreSQL. Nous utilisons l'image Bitnami qui facilite la configuration via variables d'environnement. Le `fsGroup: 1001` dans le `securityContext` permet à Bitnami d'écrire correctement sur le volume monté.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: sonar
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      securityContext:
        fsGroup: 1001
      containers:
      - name: postgres
        image: bitnami/postgresql
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 5432
        env:
        - name: ALLOW_EMPTY_PASSWORD
          value: "yes"
        - name: POSTGRESQL_USERNAME
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: username
        - name: POSTGRESQL_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: password
        - name: POSTGRESQL_DATABASE
          valueFrom:
            secretKeyRef:
              name: postgres-secret
              key: database
        volumeMounts:
        - name: postgres
          mountPath: /bitnami/postgresql
      volumes:
      - name: postgres
        persistentVolumeClaim:
          claimName: postgres-pvc
```

### Service

Le Service de type `ClusterIP` expose PostgreSQL à l'intérieur du cluster sous le nom DNS `postgres-svc`. C'est cette adresse que SonarQube utilisera dans sa `SONAR_JDBC_URL` pour se connecter à la base. La base n'est pas exposée à l'extérieur du cluster.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-svc
  namespace: sonar
  labels:
    app: postgres
spec:
  ports:
  - port: 5432
    name: postgres
  selector:
    app: postgres
```

### Kustomization FluxCD

La Kustomization indique à FluxCD quels fichiers YAML surveiller et appliquer dans le cluster. Dès qu'un de ces fichiers est modifié sur le dépôt Git, Flux réconcilie automatiquement l'état du cluster.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: sonar
resources:
  - postgres-deployment.yaml
  - postgres-service.yaml
  - postgres-pvc.yaml
  - postgres-sealed-secret.yaml
```

## 02 - Déploiement de SonarQube

Une fois la base de données opérationnelle, nous déployons SonarQube qui se connectera à PostgreSQL via JDBC.

### PersistentVolumeClaim

SonarQube stocke ses données d'analyse et ses extensions sur deux sous-chemins (`data` et `extensions`) dans ce même PVC. Nous allouons 10 Gi, suffisant pour la plupart des usages. À augmenter si le nombre de projets analysés est important.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sonar-pvc
  namespace: sonar
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: nfs-csi
```

### Secret

Ce secret contient les identifiants que SonarQube utilisera pour se connecter à PostgreSQL. Les valeurs doivent correspondre exactement à celles du secret PostgreSQL créé à l'étape précédente. À chiffrer avec kubeseal avant tout push sur Git.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: sonar-secret
  namespace: sonar
data:
  username: c29uYXJfdXNlcg==
  password: c29uYXJfcGFzcw==
```

### Deployment

SonarQube embarque un moteur Elasticsearch qui requiert que le paramètre noyau `vm.max_map_count` soit au minimum `262144` sur le nœud hôte. Sans cela, SonarQube démarre mais Elasticsearch échoue immédiatement (voir section Problèmes rencontrés). Un **initContainer privilégié** applique ce paramètre avant le démarrage du conteneur principal. La stratégie `Recreate` est nécessaire car le PVC est en `ReadWriteOnce` — deux pods ne peuvent pas écrire dessus simultanément.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sonar
  namespace: sonar
  labels:
    app: sonar
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: sonar
  template:
    metadata:
      labels:
        app: sonar
    spec:
      securityContext:
        fsGroup: 1000
      initContainers:
      - name: init
        image: busybox
        command: ["sysctl", "-w", "vm.max_map_count=262144"]
        imagePullPolicy: IfNotPresent
        securityContext:
          privileged: true
      containers:
      - name: sonarqube
        image: sonarqube:latest
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 9000
        env:
        - name: SONAR_JDBC_URL
          value: jdbc:postgresql://postgres-svc.sonar.svc.cluster.local:5432/sonar_db
        - name: SONAR_JDBC_USERNAME
          valueFrom:
            secretKeyRef:
              name: sonar-secret
              key: username
        - name: SONAR_JDBC_PASSWORD
          valueFrom:
            secretKeyRef:
              name: sonar-secret
              key: password
        volumeMounts:
        - name: app-pvc
          mountPath: /opt/sonarqube/data/
          subPath: data
        - name: app-pvc
          mountPath: /opt/sonarqube/extensions/
          subPath: extensions
        resources:
          requests:
            memory: "2Gi"
          limits:
            memory: "4Gi"
      volumes:
      - name: app-pvc
        persistentVolumeClaim:
          claimName: sonar-pvc
```

### Service

Comme pour PostgreSQL, on crée un Service `ClusterIP` pour exposer SonarQube à l'intérieur du cluster sur le port `9000`. C'est ce service que l'Ingress utilisera comme backend pour router le trafic entrant.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: sonar-svc
  namespace: sonar
  labels:
    app: sonar
spec:
  ports:
  - port: 9000
    name: sonar
  selector:
    app: sonar
```

### Kustomization FluxCD

Même principe que pour PostgreSQL : FluxCD surveille ces quatre fichiers et applique toute modification détectée sur le dépôt Git, assurant la convergence continue de l'état du cluster.

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: sonar
resources:
  - sonar-deployment.yaml
  - sonar-service.yaml
  - sonar-pvc.yaml
  - sonar-sealed-secret.yaml
```

## 03 - Ingress et certificat SSL/TLS

L'Ingress constitue le point d'entrée HTTP/HTTPS depuis l'extérieur du cluster. Il reçoit les requêtes sur `sonar.exemple.io` et les redirige vers le service `sonar-svc`. Le certificat TLS est généré avec Let's Encrypt et stocké dans un secret Kubernetes. Ce secret doit lui aussi être chiffré avec kubeseal avant d'être poussé sur Git.

Créer le secret TLS puis le chiffrer :

```bash
kubectl create secret tls sonar-tls-secret \
  --cert=/etc/letsencrypt/live/exemple.io/fullchain.pem \
  --key=/etc/letsencrypt/live/exemple.io/privkey.pem \
  --namespace sonar \
  --dry-run=client -o yaml \
  | kubeseal --cert mycert.pem -o yaml > sonar-tls-sealed-secret.yaml

kubectl apply -f sonar-tls-sealed-secret.yaml
```

Manifest Ingress :

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sonar
  namespace: sonar
  annotations:
    kubernetes.io/ingress.class: "nginx"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - sonar.exemple.io
      secretName: sonar-tls-secret
  rules:
    - host: sonar.exemple.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: sonar-svc
                port:
                  number: 9000
```

## Accès à l'application

Ajouter l'enregistrement DNS local pointant vers l'IP de l'ingress-controller :

```
ip-ingress  sonar.exemple.io
```

Accéder depuis le navigateur : `https://sonar.exemple.io`

Identifiants par défaut :
- Login : `admin`
- Mot de passe : `admin`

**À changer immédiatement après la première connexion.**

## Intégration avec GitLab CI

### Étape 1 — Créer un token d'analyse dans SonarQube

SonarQube utilise un token pour authentifier les scans lancés depuis le pipeline GitLab CI. Ce token remplace le couple login/mot de passe dans les appels à l'API SonarQube et peut être révoqué à tout moment sans changer les identifiants de l'application.

Dans SonarQube : **Administration → Security → Users → votre compte → Tokens → Generate**

- Nom : `gitlab-ci-token`
- Type : `Global Analysis Token` (ou `Project Analysis Token` pour restreindre à un projet)

Copier la valeur du token — elle ne sera affichée qu'une seule fois.

### Étape 2 — Configurer les variables CI/CD dans GitLab

Plutôt que d'écrire le token en clair dans le fichier `.gitlab-ci.yml` (qui est versionné), on le stocke dans les variables CI/CD de GitLab. Ces variables sont injectées automatiquement dans l'environnement de chaque job sans jamais apparaître dans les logs ni dans le code source.

Dans le dépôt GitLab : **Settings → CI/CD → Variables → Add variable**

| Variable | Valeur | Options |
|----------|--------|---------|
| `SONAR_TOKEN` | token généré à l'étape 1 | Masked, Protected |
| `SONAR_HOST_URL` | `https://sonar.exemple.io` | — |

### Étape 3 — Ajouter le job SonarQube dans `.gitlab-ci.yml`

Ce job utilise l'image officielle `sonar-scanner-cli` de SonarSource. Le paramètre `GIT_DEPTH: "0"` est indispensable : sans lui, GitLab effectue un clone superficiel (shallow clone) qui prive SonarQube de l'historique Git nécessaire pour calculer correctement la couverture des branches. Le cache `.sonar/cache` évite de re-télécharger les plugins à chaque pipeline.

```yaml
stages:
  - test
  - quality

sonarqube-check:
  stage: quality
  image:
    name: sonarsource/sonar-scanner-cli:latest
    entrypoint: [""]
  variables:
    SONAR_USER_HOME: "${CI_PROJECT_DIR}/.sonar"
    GIT_DEPTH: "0"
  cache:
    key: "${CI_JOB_NAME}"
    paths:
      - .sonar/cache
  script:
    - sonar-scanner
        -Dsonar.projectKey=${CI_PROJECT_NAME}
        -Dsonar.projectName=${CI_PROJECT_NAME}
        -Dsonar.sources=.
        -Dsonar.host.url=${SONAR_HOST_URL}
        -Dsonar.token=${SONAR_TOKEN}
        -Dsonar.gitlab.project_id=${CI_PROJECT_ID}
        -Dsonar.gitlab.commit_sha=${CI_COMMIT_SHA}
        -Dsonar.gitlab.ref_name=${CI_COMMIT_REF_NAME}
  allow_failure: true
  only:
    - main
    - merge_requests
```

### Étape 4 — Configurer `sonar-project.properties` (optionnel)

Ce fichier placé à la racine du projet centralise la configuration SonarQube côté dépôt. Il évite de surcharger le `.gitlab-ci.yml` avec de nombreux paramètres `-D` et permet de versionner la configuration d'analyse avec le code. Si ce fichier est présent, sonar-scanner le détecte automatiquement.

```properties
sonar.projectKey=mon-projet
sonar.projectName=Mon Projet
sonar.sources=src
sonar.exclusions=**/node_modules/**,**/dist/**,**/*.test.js
sonar.language=js
```

### Résultat attendu

À chaque push sur `main` ou ouverture d'une merge request, le pipeline GitLab déclenche une analyse SonarQube. Le rapport est visible directement dans l'interface SonarQube (`https://sonar.exemple.io`) avec :
- Le nombre de bugs, vulnérabilités et code smells détectés
- La couverture de tests (si configurée)
- L'évolution de la dette technique
- Le statut **Quality Gate** (Passed / Failed)

## Problèmes rencontrés et solutions

### 1 - AccessDeniedException sur `/opt/sonarqube/data/es8`

Au démarrage de SonarQube, les logs affichaient :

```
Caused by: java.nio.file.AccessDeniedException: /opt/sonarqube/data/es8
```

**Cause :** Elasticsearch (embarqué dans SonarQube) requiert que le paramètre noyau `vm.max_map_count` soit au minimum `262144`. Sur un nœud Kubernetes standard, cette valeur est insuffisante et Elasticsearch ne peut pas créer ses index de données.

**Solution :** ajouter un **initContainer privilégié** dans le Deployment pour modifier ce paramètre avant le démarrage du conteneur SonarQube (déjà inclus dans le manifest ci-dessus) :

```yaml
initContainers:
- name: init
  image: busybox
  command: ["sysctl", "-w", "vm.max_map_count=262144"]
  securityContext:
    privileged: true
```

### 2 - Erreur 504 lors de la configuration du runner GitLab

En configurant un runner GitLab, la commande de clonage échouait avec :

```
fatal: unable to access 'https://git.exemple.io/root/infra-exemple.git/':
The requested URL returned error: 504
```

**Cause :** le runner ne parvenait pas à joindre le serveur GitLab auto-hébergé. Le DNS interne du runner ne résolvait pas `git.exemple.io`, provoquant un timeout (504) sur la connexion HTTPS.

**Solution :** s'assurer que le runner dispose d'un enregistrement DNS pour le domaine GitLab interne. Si le runner tourne dans Kubernetes, enrichir le CoreDNS du cluster avec un bloc `hosts` (identique à la procédure décrite dans l'article sur le workflow GitOps) :

```bash
kubectl edit configmap/coredns -n kube-system
```

```
hosts {
    ip-machine git.exemple.io
    fallthrough
}
```

Si le runner tourne sur une machine hors cluster, ajouter l'entrée dans `/etc/hosts` de cette machine.
