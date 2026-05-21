---
title: "Déployer un LLM local avec Mistral et Open WebUI"
description: "Comment héberger soi-même un modèle de langage Mistral-7B via Ollama et l'exposer avec une interface graphique Open WebUI, sans aucune dépendance à un service cloud tiers."
publishDate: 2026-05-20
author: "Cabinet conseil"
tags: ["IA", "LLM", "Souveraineté", "Mistral", "Self-hosted"]
---

## Contexte et objectif

Cet article décrit le déploiement d'un modèle de langage (LLM) en local, entièrement auto-hébergé sur une machine Linux disposant d'un GPU NVIDIA. Nous utilisons **Mistral-7B** (version quantifiée 4-bit) servi par **Ollama**, et **Open WebUI** comme interface graphique accessible depuis le réseau privé via HTTPS.

L'objectif est de disposer d'un assistant IA souverain : aucun document, aucune requête ne transite par un service tiers. Tout reste sur l'infrastructure interne.

## Architecture déployée

- **Ollama**
  - Rôle : moteur d'inférence LLM, expose une API REST locale
  - Modèle : `mistral` (7B quantifié 4-bit, ~4 Go de VRAM)
  - Écoute : `0.0.0.0:11434` (réseau privé VPN)
- **Open WebUI**
  - Image Docker : `ghcr.io/open-webui/open-webui:main`
  - Rôle : interface graphique type ChatGPT connectée à l'API Ollama
  - Port exposé : `3000` (mappé sur `8080` interne)
- **NGINX**
  - Rôle : reverse proxy HTTPS avec certificat Let's Encrypt wildcard `*.exemple.io`
  - Domaine : `mistral.exemple.io`

## Prérequis

### Configuration matérielle minimale (Mistral-7B quantifié 4-bit)

| Composant | Minimum recommandé |
|-----------|-------------------|
| GPU VRAM |    16 Go (ex. NVIDIA RTX 3090) |
| RAM système | 16 à 32 Go |
| Stockage |    8 Go (modèle quantifié) |
| OS |          Linux — Ubuntu recommandé |

Vérifier que le GPU est bien détecté :

```bash
nvidia-smi
```

## Etapes de déploiement

## 01 - Installation et configuration de Docker

```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl enable --now docker

# Ajouter l'utilisateur courant au groupe docker (évite le sudo à chaque commande)
sudo usermod -aG docker $USER
newgrp docker
```

## 02 - Installation des pilotes NVIDIA

Installer le pilote GPU :

```bash
sudo apt install -y nvidia-driver-535
sudo reboot
```

Après le redémarrage, ajouter le dépôt NVIDIA Container Toolkit :

```bash
distribution=$(. /etc/os-release; echo $ID$VERSION_ID) \
  && curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
  && curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
```

> **Note Ubuntu 24.10 :** NVIDIA ne publie pas encore de dépôt pour Ubuntu 24.10. Si `sudo apt update` échoue, voir la section Problèmes rencontrés.

Installer le toolkit et l'intégrer à Docker :

```bash
sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Vérifier que Docker accède bien au GPU :

```bash
docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubuntu20.04 nvidia-smi
```

## 03 - Installation de Mistral via Ollama

Ollama est un outil open source qui simplifie le téléchargement et l'exécution de LLMs en local. Il expose automatiquement une API REST compatible avec l'écosystème OpenAI.

Installation :

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Télécharger et lancer Mistral (la commande télécharge le modèle si absent, puis le lance) :

```bash
ollama run mistral
```

Le modèle quantifié pèse environ 4 Go. Le téléchargement initial peut prendre quelques minutes selon la connexion.

## 04 - Exposer l'API Ollama sur le réseau

Par défaut, Ollama n'écoute que sur `127.0.0.1`. Pour qu'Open WebUI (sur une autre IP du réseau) puisse contacter l'API, il faut modifier la configuration du service systemd.

Ouvrir le fichier de service :

```bash
sudo nano /etc/systemd/system/ollama.service
```

Ajouter la variable d'environnement sous la section `[Service]` :

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Recharger et redémarrer le service :

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

L'API Ollama est maintenant accessible depuis le réseau sur le port `11434`.

## 05 - Déploiement d'Open WebUI

Open WebUI fournit une interface graphique complète (gestion de conversations, historique, sélection de modèles) connectée à l'API Ollama.

```bash
docker run -d \
  --name open-webui \
  -p 3000:8080 \
  -e OLLAMA_API_BASE_URL=http://ip-machine:11434 \
  -v open-webui:/app/backend/data \
  --restart always \
  ghcr.io/open-webui/open-webui:main
```

Remplacer `ip-machine` par l'IP de la machine sur laquelle Ollama est installé (ex. IP VPN ou réseau privé). Open WebUI est maintenant accessible en HTTP sur le port `3000`.

## 06 - Reverse proxy NGINX avec HTTPS

Pour accéder à Open WebUI via un nom de domaine et en HTTPS, on configure NGINX comme reverse proxy. Transférer au préalable le certificat wildcard `*.exemple.io` sur la machine et le placer dans `/etc/mistral/open_webui_ssl/`.

Configuration NGINX :

```nginx
server {
    listen 443 ssl;
    server_name mistral.exemple.io;

    ssl_certificate     /etc/mistral/open_webui_ssl/fullchain.pem;
    ssl_certificate_key /etc/mistral/open_webui_ssl/privkey.pem;

    location / {
        proxy_pass http://ip-machine:3000;
        proxy_http_version 1.1;

        # Headers WebSocket — indispensables pour le streaming des réponses
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Désactiver le buffering pour le streaming token par token
        proxy_buffering off;
        proxy_request_buffering off;
    }
}

server {
    listen 80;
    server_name mistral.exemple.io;
    return 301 https://$host$request_uri;
}
```

Redémarrer NGINX pour appliquer la configuration :

```bash
systemctl restart nginx
```

## Accès à l'application

Ajouter l'enregistrement DNS local sur les postes clients. Sous Linux : `/etc/hosts`. Sous Windows, ouvrir un terminal en mode administrateur :

```bash
notepad C:\Windows\System32\drivers\etc\hosts
```

Ajouter la ligne :

```
ip-machine  mistral.exemple.io
```

Accéder depuis le navigateur : `https://mistral.exemple.io`

À la première connexion, Open WebUI demande de créer un compte administrateur local. Une fois connecté, Mistral est disponible dans le sélecteur de modèles et les conversations peuvent commencer.

## Problèmes rencontrés et solutions

### 1 - Échec de l'installation du pilote NVIDIA sous Ubuntu 24.10

Après ajout du dépôt NVIDIA, la commande `sudo apt update` renvoyait des erreurs de dépôt. NVIDIA ne fournit pas encore de paquets officiels pour Ubuntu 24.10.

**Solution :** forcer l'utilisation du dépôt Ubuntu 18.04, qui est rétrocompatible. Modifier le fichier de sources :

```bash
sudo nano /etc/apt/sources.list.d/nvidia-container-toolkit.list
```

Remplacer l'URL générée automatiquement par :

```
https://nvidia.github.io/libnvidia-container/ubuntu18.04/libnvidia-container.list
```

Relancer ensuite `sudo apt update && sudo apt install -y nvidia-container-toolkit`.

### 2 - API Ollama inaccessible depuis Open WebUI

Open WebUI ne parvenait pas à contacter l'API Ollama en utilisant l'IP de la machine (ex. IP VPN). La connexion était refusée car Ollama n'écoutait que sur `localhost`.

**Solution :** ajouter la variable `OLLAMA_HOST` dans la configuration systemd du service Ollama (étape 04) :

```bash
sudo nano /etc/systemd/system/ollama.service
```

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Après redémarrage, l'API répond bien sur toutes les interfaces réseau.
