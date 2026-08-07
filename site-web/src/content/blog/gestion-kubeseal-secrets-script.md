---
title: "Gérer les Sealed Secrets Kubernetes avec un script Bash"
description: "Un script Bash pour automatiser les opérations courantes avec kubeseal : chiffrement de secrets, rotation, récupération du certificat public et intégration dans un workflow GitOps."
publishDate: 2026-07-07
author: "Cabinet conseil"
tags: ["Kubernetes", "kubeseal", "Sealed Secrets", "GitOps", "Sécurité"]
---

## Contexte et objectif

Dans un workflow GitOps, tous les manifests Kubernetes — y compris les secrets — sont versionnés dans un dépôt Git. Pousser un `Secret` Kubernetes en clair (même encodé en base64) expose des données sensibles à quiconque a accès au dépôt. **Sealed Secrets** (Bitnami) résout ce problème : un contrôleur cluster-side détient la clé privée et déchiffre les `SealedSecret` à la volée ; seul le cluster peut lire la valeur réelle.

`kubeseal` est le CLI qui chiffre les secrets côté client à l'aide du certificat public du contrôleur. Les opérations répétitives (récupérer le certificat, construire un secret temporaire, le chiffrer, nettoyer) sont fastidieuses à la main. Ce script les regroupe en commandes simples utilisables au quotidien.

## Prérequis

- `kubectl` configuré et pointant vers le bon cluster
- `kubeseal` installé ([releases GitHub](https://github.com/bitnami-labs/sealed-secrets/releases))
- Le contrôleur `sealed-secrets-controller` déployé dans le namespace `kube-system`

Vérifier que le contrôleur est actif :

```bash
kubectl get pods -n kube-system | grep sealed-secrets
```

## Le script

```bash
#!/usr/bin/env bash
# ks.sh — wrapper kubeseal pour les opérations quotidiennes

set -euo pipefail

CERT_CACHE="${HOME}/.kube/sealed-secrets-cert.pem"
CONTROLLER_NAME="sealed-secrets-controller"
CONTROLLER_NS="kube-system"

usage() {
  cat <<EOF
Usage: ks.sh <commande> [options]

Commandes :
  fetch-cert                        Télécharge et met en cache le certificat public
  seal    -f <secret.yaml>          Chiffre un Secret Kubernetes existant
  create  -n <namespace> -s <name>  Crée un SealedSecret depuis des paires KEY=VALUE
          KEY=VALUE [KEY=VALUE ...]
  rotate  -f <sealed.yaml>          Rechiffre un SealedSecret avec le certificat actuel
  verify  -f <sealed.yaml>          Vérifie qu'un SealedSecret est bien formé
  list    [-n <namespace>]          Liste les SealedSecrets déployés dans le cluster
EOF
  exit 1
}

fetch_cert() {
  echo "Récupération du certificat public..."
  kubeseal --fetch-cert \
    --controller-name="${CONTROLLER_NAME}" \
    --controller-namespace="${CONTROLLER_NS}" \
    > "${CERT_CACHE}"
  echo "Certificat enregistré : ${CERT_CACHE}"
}

ensure_cert() {
  if [[ ! -f "${CERT_CACHE}" ]]; then
    echo "Certificat absent, téléchargement automatique..."
    fetch_cert
  fi
}

seal_file() {
  local file=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      -f) file="$2"; shift 2 ;;
      *) echo "Option inconnue : $1"; usage ;;
    esac
  done
  [[ -z "${file}" ]] && { echo "Erreur : -f requis"; usage; }
  ensure_cert
  local out="${file%.yaml}-sealed.yaml"
  kubeseal --cert "${CERT_CACHE}" -o yaml < "${file}" > "${out}"
  echo "SealedSecret généré : ${out}"
}

create_secret() {
  local namespace="" name=""
  local -a pairs=()
  while [[ $# -gt 0 ]]; do
    case $1 in
      -n) namespace="$2"; shift 2 ;;
      -s) name="$2"; shift 2 ;;
      *=*) pairs+=("$1"); shift ;;
      *) echo "Option inconnue : $1"; usage ;;
    esac
  done
  [[ -z "${namespace}" || -z "${name}" ]] && { echo "Erreur : -n et -s requis"; usage; }
  [[ ${#pairs[@]} -eq 0 ]] && { echo "Erreur : au moins une paire KEY=VALUE requise"; usage; }

  ensure_cert

  # Construire les arguments --from-literal
  local literals=()
  for pair in "${pairs[@]}"; do
    literals+=("--from-literal=${pair}")
  done

  local tmp
  tmp=$(mktemp --suffix=.yaml)
  trap 'rm -f "${tmp}"' EXIT

  kubectl create secret generic "${name}" \
    --namespace="${namespace}" \
    --dry-run=client -o yaml \
    "${literals[@]}" > "${tmp}"

  local out="${name}-sealed.yaml"
  kubeseal --cert "${CERT_CACHE}" -o yaml < "${tmp}" > "${out}"
  echo "SealedSecret généré : ${out}"
}

rotate_secret() {
  local file=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      -f) file="$2"; shift 2 ;;
      *) echo "Option inconnue : $1"; usage ;;
    esac
  done
  [[ -z "${file}" ]] && { echo "Erreur : -f requis"; usage; }

  fetch_cert  # on force le rechargement du certificat

  # Extraire le namespace et le nom depuis le SealedSecret existant
  local namespace name
  namespace=$(grep -m1 'namespace:' "${file}" | awk '{print $2}')
  name=$(grep -m1 'name:' "${file}" | awk '{print $2}')

  echo "Rechiffrement de ${name} (namespace: ${namespace})..."

  # Récupérer le Secret déchiffré depuis le cluster, rechiffrer
  kubectl get secret "${name}" -n "${namespace}" -o yaml \
    | kubeseal --cert "${CERT_CACHE}" -o yaml > "${file}"

  echo "SealedSecret mis à jour : ${file}"
}

verify_secret() {
  local file=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      -f) file="$2"; shift 2 ;;
      *) echo "Option inconnue : $1"; usage ;;
    esac
  done
  [[ -z "${file}" ]] && { echo "Erreur : -f requis"; usage; }

  if grep -q 'kind: SealedSecret' "${file}"; then
    echo "Format valide : SealedSecret détecté dans ${file}"
  else
    echo "Erreur : ${file} ne semble pas être un SealedSecret"
    exit 1
  fi

  local namespace name
  namespace=$(grep -m1 'namespace:' "${file}" | awk '{print $2}')
  name=$(grep -m1 'name:' "${file}" | awk '{print $2}')

  if kubectl get sealedsecret "${name}" -n "${namespace}" &>/dev/null; then
    echo "SealedSecret '${name}' présent dans le cluster (namespace: ${namespace})"
  else
    echo "SealedSecret '${name}' non trouvé dans le cluster — pas encore appliqué ?"
  fi
}

list_secrets() {
  local namespace=""
  while [[ $# -gt 0 ]]; do
    case $1 in
      -n) namespace="$2"; shift 2 ;;
      *) echo "Option inconnue : $1"; usage ;;
    esac
  done

  if [[ -n "${namespace}" ]]; then
    kubectl get sealedsecrets -n "${namespace}"
  else
    kubectl get sealedsecrets -A
  fi
}

[[ $# -eq 0 ]] && usage

cmd="$1"; shift
case "${cmd}" in
  fetch-cert)   fetch_cert ;;
  seal)         seal_file "$@" ;;
  create)       create_secret "$@" ;;
  rotate)       rotate_secret "$@" ;;
  verify)       verify_secret "$@" ;;
  list)         list_secrets "$@" ;;
  *)            echo "Commande inconnue : ${cmd}"; usage ;;
esac
```

Rendre le script exécutable :

```bash
chmod +x ks.sh
```

## Utilisation

### Récupérer le certificat public

Le certificat est mis en cache dans `~/.kube/sealed-secrets-cert.pem`. Toutes les autres commandes le téléchargent automatiquement s'il est absent.

```bash
./ks.sh fetch-cert
```

À renouveler manuellement après une rotation des clés du contrôleur.

### Chiffrer un Secret existant

Partir d'un manifest `Secret` Kubernetes existant (non poussé sur Git) et produire le `SealedSecret` correspondant.

```bash
./ks.sh seal -f postgres-secret.yaml
# → postgres-secret-sealed.yaml
```

Le fichier source n'est **jamais** modifié. Seul le fichier `-sealed.yaml` est destiné au dépôt Git.

### Créer un SealedSecret depuis des valeurs

Construire un `SealedSecret` directement depuis des paires `KEY=VALUE`, sans créer de fichier Secret intermédiaire sur disque.

```bash
./ks.sh create -n monitoring -s grafana-secret \
  GF_SECURITY_ADMIN_USER=admin \
  GF_SECURITY_ADMIN_PASSWORD=MonMotDePasse
# → grafana-secret-sealed.yaml
```

Le secret temporaire est créé en mémoire (`--dry-run=client`) et immédiatement chiffré ; il n'est jamais écrit en clair sur le disque.

### Rotation d'un SealedSecret

Après une rotation des clés du contrôleur, les SealedSecrets chiffrés avec l'ancienne clé restent déchiffrables (le contrôleur conserve les anciennes clés), mais il est recommandé de les rechiffrer avec le certificat actuel.

```bash
./ks.sh rotate -f postgres-secret-sealed.yaml
```

Le fichier est rechiffré sur place. Le Secret déchiffré est lu depuis le cluster (pas depuis le disque).

### Vérifier un SealedSecret

Contrôle rapide avant un push : le fichier est-il bien un `SealedSecret` et le contrôleur l'a-t-il déjà appliqué ?

```bash
./ks.sh verify -f postgres-secret-sealed.yaml
```

### Lister les SealedSecrets déployés

```bash
./ks.sh list                  # tous namespaces
./ks.sh list -n monitoring    # namespace spécifique
```

## Intégration GitOps

Dans un workflow FluxCD ou ArgoCD, seuls les fichiers `-sealed.yaml` sont poussés sur Git. Le pipeline CI peut appeler `ks.sh verify` pour valider le format avant merge.

Exemple de job GitLab CI :

```yaml
verify-secrets:
  stage: validate
  image: bitnami/kubectl:latest
  before_script:
    - curl -sL https://github.com/bitnami-labs/sealed-secrets/releases/latest/download/kubeseal-linux-amd64
        -o /usr/local/bin/kubeseal && chmod +x /usr/local/bin/kubeseal
  script:
    - for f in $(find . -name "*-sealed.yaml"); do ./ks.sh verify -f "$f"; done
  only:
    - merge_requests
```

## Problèmes rencontrés et solutions

### 1 - `error: cannot fetch certificate`

```
error: cannot fetch certificate: services "sealed-secrets-controller" not found
```

**Cause :** le nom ou le namespace du contrôleur diffère de la valeur par défaut. Certains charts Helm déploient le contrôleur sous un autre nom (ex. `sealed-secrets`).

**Solution :** identifier le bon nom et ajuster les variables en tête de script :

```bash
kubectl get pods -A | grep sealed
# sealed-secrets-controller  →  CONTROLLER_NAME="sealed-secrets-controller"
# sealed-secrets              →  CONTROLLER_NAME="sealed-secrets"
```

### 2 - SealedSecret appliqué mais Secret non créé

Le Secret n'apparaît pas après `kubectl apply -f mon-sealed.yaml`.

**Cause fréquente :** le `namespace` déclaré dans le SealedSecret ne correspond pas au namespace cible, ou le namespace n'existe pas encore.

**Solution :** vérifier les logs du contrôleur :

```bash
kubectl logs -n kube-system deployment/sealed-secrets-controller | tail -20
```

Un message `no key could decrypt secret` indique une mauvaise clé (certificat issu d'un autre cluster). Rechiffrer avec le bon certificat (`ks.sh fetch-cert` puis `ks.sh seal`).

### 3 - `rotate` échoue si le Secret n'existe pas dans le cluster

La commande `rotate` lit le Secret déchiffré depuis le cluster. Si le `SealedSecret` n'a jamais été appliqué (ou le cluster est différent), le Secret n'existe pas encore.

**Solution :** dans ce cas, repartir des valeurs d'origine avec `ks.sh create` et le nouveau certificat.
