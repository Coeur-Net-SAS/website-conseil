---
title: "Deployer un logiciel de signature electronique interne sur kubernetes"
description: "Comment deployer un logiciel open source pour permettre les signatures electronique tout en evitant que les documents confidentiels transitent par des serveurs tiers"
publishDate: 2026-05-18
author: "Cabinet conseil"
tags: ["Kubernetes", "Souveraineté", "Signature Electronique"]
---

## Contexte et objectif

Cet article décrit le déploiement de DocuSeal, une solution open source de signature électronique, sur un cluster Kubernetes managé OVH. DocuSeal permet la signature électronique de documents PDF en interne, sans dépendance à un service SaaS tiers, avec une maîtrise totale des données.

## Architecture déployée

- **docuseal-app**
  - Image Docker : `docuseal/docuseal:latest`
  - Rôle : Application principale de signature électronique
- **docuseal-postgres**
  - Image Docker : `postgres:16-alpine`
  - Rôle : Base de données relationnelle PostgreSQL
- **docuseal-data-pvc** : Stockage persistant des documents
- **postgres-data-pvc** : Stockage persistant PostgreSQL 

## Etapes de déploiement

## 00 - Namespace
Pour une bonne organisation nous allons créer un namespace (espace de nom) spécial dans lequel nous allons déployer notre application. Cela permet d'isoler les ressources et les configurations spécifiques à DocuSeal.
- Commande : `kubectl create namespace docuseal`
## 00 - bis Configuration SMTP (envoi d’emails de signature)

DocuSeal necessite  un mail pour l'envoi des documents à signer (`moncompte@gmail.com`)
La configuration suivante doit être effectuée sur votre compte mail:
- Activation de la **double authentification (2FA)** 
- Génération d’un **mot de passe d’application**
- Utilisation de ce mot de passe dans la variable `SMTP_PASSWORD` du fichier `01 - secrets.yaml`

## 01 - Secrets
Afin de sécuriser notre déploiement, nous devons créer des secrets pour stocker les informations sensibles comme le mot de passe PostgreSQL. Ces secrets seront ensuite utilisés dans la configuration de l'application et de la base de données.
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: docuseal-secret
  namespace: docuseal
  labels:
    app.kubernetes.io/name: docuseal
    app.kubernetes.io/part-of: docuseal
type: Opaque
data:
  postgres-password: #votre mdp encodé en base64 : echo "mdp" | base64
  secret-key-base: #secret key généré par `openssl rand -hex 64 | base64`
  smtp-password: #votre mdp encodé en base64 : echo "mdp" | base64 
```
Ensuite appliquer le secret dans le cluster
- Commande : `kubectl apply -f docuseal-secret.yaml`
## 02 - Configmap
Necessaire pour définir des variables d'environnement qui seront utilisées par l'application. Par exemple, les paramètres de connexion à la base de données.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: docuseal-config
  namespace: docuseal
  labels:
    app.kubernetes.io/name: docuseal
    app.kubernetes.io/part-of: docuseal
data:
  # ----- Application -----
  # URL publique de l'instance (adaptez selon votre Ingress)
  HOST: "localhost"
  FORCE_SSL: "false"           # Mettre "true" si TLS est géré par l'Ingress/cert-manager

  # ----- SMTP (envoi des emails aux signataires) -----
  SMTP_ADDRESS: "smtp.gmail.com"
  SMTP_PORT: "587"
  SMTP_DOMAIN: "gmail.com"
  SMTP_FROM: "votre-adresse-mail-source"
  SMTP_AUTH: "login"
  SMTP_ENABLE_STARTTLS: "true"
 # ----- Timezone -----
  TZ: "Europe/Paris"
```
Ensuite appliquer le secret dans le cluster
- Commande : `kubectl apply -f docuseal-configmap.yaml`
## 03 - PVC
Afin de rendre les données persistantes au redemarrage d'un pod, il faut créer un PersistentVolumeClaim (PVC). Nous créerons deux pvc : un concernant la base de données postgresql(gestion des users, permissions ...) et un autre pour docuseal lui même (gestion des documents).
```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: docuseal-data-pvc
  namespace: docuseal
  labels:
    app.kubernetes.io/name: docuseal
    app.kubernetes.io/part-of: docuseal
spec:
  accessModes:
    - ReadWriteOnce

  storageClassName: csi-cinder-high-speed
  resources:
    requests:
      storage: 5Gi

---
# --- PVC pour les données PostgreSQL ---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-pvc
  namespace: docuseal
  labels:
    app.kubernetes.io/name: postgres
    app.kubernetes.io/part-of: docuseal
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: csi-cinder-high-speed
  resources:
    requests:
      storage: 5Gi
```
Pour déterminer votre storageClassName, vous pouvez exécuter la commande suivante dans votre cluster : `kubectl get storageclass`.
Appliquer ensuite le fichier YAML pour créer les PVC : `kubectl apply -f docuseal-pvc.yaml`
## 04 - Déploiement de Postgres
Pour stocker tout l'état de lapplication, nous allons déployer une instance de postgres dans notre cluster kubernetes.
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: docuseal
  labels:
    app: postgres
    app.kubernetes.io/name: postgres
    app.kubernetes.io/part-of: docuseal
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  strategy:
    type: Recreate   # Nécessaire avec ReadWriteOnce PVC
  template:
    metadata:
      labels:
        app: postgres
        app.kubernetes.io/name: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 5432
              name: postgres
          env:
            - name: POSTGRES_DB
              value: "docuseal"
            - name: POSTGRES_USER
              value: "docuseal"
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: docuseal-secret
                  key: postgres-password
            - name: PGDATA
              value: "/var/lib/postgresql/data/pgdata"
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: postgres-data
          persistentVolumeClaim:
            claimName: postgres-data-pvc
```
# Service associé :
Pour trouver et contacter l'instance postgresql déployé ci-dessus il est necessaire de créer un service associé pour permettre l'accès à cette instance.
``` yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-svc
  namespace: docuseal
  labels:
    app: postgres
    app.kubernetes.io/name: postgres
    app.kubernetes.io/part-of: docuseal
spec:
  type: ClusterIP
  selector:
    app: postgres
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
```
On oublie pas les apply : `kubectl apply -f docuseal-postgres.yaml ` et `kubectl apply -f docuseal-postgres-svc.yaml`
## 05 - Docuseal
Nous allons à présent déployer l'instance de docuseal via son image docker
``` yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: docuseal
  namespace: docuseal
  labels:
    app: docuseal
    app.kubernetes.io/name: docuseal
    app.kubernetes.io/part-of: docuseal
  annotations:
    # Forcer le redémarrage lors d'un changement de ConfigMap/Secret :
    # kubectl rollout restart deployment/docuseal -n esignature
spec:
  replicas: 1
  selector:
    matchLabels:
      app: docuseal
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: docuseal
        app.kubernetes.io/name: docuseal
    spec:
      containers:
        - name: docuseal
          image: docuseal/docuseal:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 3000
              name: http
          env:
            # --- Base de données ---
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: docuseal-secret
                  key: postgres-password
            - name: DATABASE_URL
              value: "postgresql://docuseal:$(POSTGRES_PASSWORD)@postgres-svc:5432/docuseal"

            # --- Clé secrète Rails ---
            - name: SECRET_KEY_BASE
              valueFrom:
                secretKeyRef:
                  name: docuseal-secret
                  key: secret-key-base

            # --- Application ---
            - name: HOST
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: HOST
            - name: FORCE_SSL
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: FORCE_SSL
            - name: TZ
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: TZ

            # --- SMTP ---
            - name: SMTP_ADDRESS
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: SMTP_ADDRESS
            - name: SMTP_PORT
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: SMTP_PORT
            - name: SMTP_DOMAIN
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: SMTP_DOMAIN
            - name: SMTP_FROM
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: SMTP_FROM
            - name: SMTP_USERNAME
              valueFrom:
                secretKeyRef:
                  name: docuseal-smtp-secret
                  key: smtp-username
            - name: SMTP_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: docuseal-smtp-secret
                  key: smtp-password
            - name: SMTP_AUTH
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: SMTP_AUTH
            - name: SMTP_ENABLE_STARTTLS
              valueFrom:
                configMapKeyRef:
                  name: docuseal-config
                  key: SMTP_ENABLE_STARTTLS

          volumeMounts:
            - name: docuseal-data
              mountPath: /data

          

      volumes:
        - name: docuseal-data
          persistentVolumeClaim:
            claimName: docuseal-data-pvc

      # Politique de redémarrage en cas de crash
      restartPolicy: Always
```
Ensuite : `kubectl apply -f docuseal-deployment.yaml`
### Service associé : 
Pour permettre les accès dans le cluster a ce pod, il faut également lui mettre un service associé, on peut distinguer différents services : 
- `ClusterIP` : expose le pod uniquement à l’intérieur du cluster Kubernetes (accessible seulement par les autres services internes).
- `NodePort` : expose le pod sur un port spécifique de chaque nœud, accessible depuis l’extérieur via `NodeIP:NodePort`.
- `LoadBalancer` : expose le service à l’extérieur via un load balancer externe (cloud), avec une IP publique stable.
```yaml
apiVersion: v1
kind: Service
metadata:
  name: docuseal-svc
  namespace: docuseal
  labels:
    app: docuseal
    app.kubernetes.io/name: docuseal
    app.kubernetes.io/part-of: docuseal
spec:
  type: ClusterIP
  selector:
    app: docuseal
  ports:
    - name: http
      port: 80
      targetPort: 3000
      protocol: TCP
```
Nous utilisons ClusterIP car notre cluster se trouve derrière un ingress controller, ce qui permet de centraliser l’accès externe via l’Ingress et de garder les services internes non exposés directement.
## 06 - Ingress
Constitue le point d’entrée HTTP externe vers les services du cluster Kubernetes via les règles de routage (host/path).
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: docuseal-ingress
  namespace: docuseal
  labels:
    app: docuseal
    app.kubernetes.io/name: docuseal
    app.kubernetes.io/part-of: docuseal
  annotations:
    # --- nginx-ingress (décommenter selon votre controller) ---
    kubernetes.io/ingress.class: "nginx"

spec:
  # --- TLS (décommenter et adapter ) ---
  # tls:
  #   - hosts:
  #       - mondomaine@domaine.fr
  #     secretName: docuseal-tls-cert

  rules:
    - host: "mondomaine@domaine.fr"   # ← Adaptez à votre domaine interne
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: docuseal-svc
                port:
                  number: 80
```
Enfin `kubectl apply -f docuseal-ingress.yaml` et votre déploiement sera accessible sur `mondomaine@domaine.fr` 

