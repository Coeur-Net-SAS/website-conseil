---
title: "Remplacer un assistant de code propriétaire par un LLM local"
description: "Comment évaluer et déployer un modèle de génération de code auto-hébergé via Ollama pour remplacer un assistant SaaS, avec une méthodologie de benchmark reproductible et les résultats comparatifs de neuf modèles open source."
publishDate: 2026-04-08
author: "Cabinet conseil"
tags: ["IA", "LLM", "Souveraineté", "Benchmark", "Ollama"]
---

## Contexte et objectif

Un assistant de code en SaaS transmet le code source aux serveurs du fournisseur à chaque requête. Pour des équipes travaillant sur du code propriétaire ou soumis à des contraintes de conformité, ce transit de données est inacceptable.

L'objectif de cette démarche est de remplacer cet assistant par une solution entièrement auto-hébergée : le modèle tourne sur l'infrastructure interne, aucune requête ne sort du réseau, et le coût de licence récurrent disparaît au profit d'un coût matériel maîtrisé.

Cet article décrit la méthodologie de benchmark utilisée pour sélectionner le meilleur modèle, les résultats comparatifs de neuf modèles open source, et les étapes pour intégrer le modèle retenu dans l'IDE des développeurs.

## Architecture retenue

- **Ollama** : moteur d'inférence local, expose une API REST compatible OpenAI sur le port `11434`
- **Modèles** : téléchargés et gérés par Ollama depuis le registre officiel `ollama.com`
- **continue.dev** : extension VSCode/JetBrains qui connecte l'IDE au modèle local
- **GPU NVIDIA** : indispensable pour une latence acceptable sur des modèles 7B et plus

## Prérequis matériels

- **GPU VRAM** : 8 Go minimum pour les modèles 7B (16 Go recommandés), 8 Go suffisent pour les 3B, 24 Go nécessaires pour les 16B
- **RAM système** : 16 Go minimum, 32 Go recommandés
- **Stockage** : environ 10 Go par modèle, SSD NVMe conseillé pour des temps de chargement courts
- **OS** : Linux Ubuntu recommandé (Ubuntu LTS de préférence)

## Méthodologie de benchmark

Avant de choisir un modèle, il faut l'évaluer sur des tâches représentatives de l'usage réel. Un benchmark générique (MMLU, HumanEval) ne suffit pas : les résultats académiques ne reflètent pas toujours le comportement sur le workflow concret de l'équipe. La bonne approche est de définir ses propres scénarios de test, sa grille de notation, puis de tester chaque modèle dans des conditions identiques.

### Étape 1 : Définir les scénarios de test

Chaque scénario doit correspondre à une tâche réelle du quotidien des développeurs. Trois types de tâches couvrent l'essentiel des usages en développement :

**Test 1 : Génération de code (backend)**

Prompt envoyé à chaque modèle :

```
Génère un fichier main.py complet implémentant une API FastAPI.
Contraintes :
- CRUD en mémoire sur une ressource Task avec les champs id, title, done
- Modèle Pydantic pour la validation
- Gestion des erreurs avec HTTPException
Fournis uniquement le code, sans texte explicatif autour.
```

Critères d'évaluation : exactitude du code, respect des contraintes, absence de verbosité inutile.

**Test 2 : Génération de code (frontend)**

Prompt envoyé à chaque modèle :

```
Génère un fichier main.dart autonome et exécutable.
Contraintes :
- Affichage d'une liste d'articles avec titre et sous-titre
- Navigation vers une page de détail affichant titre et description
Fournis uniquement le code, sans explications.
```

Critères d'évaluation : exactitude, structure de navigation, autonomie du fichier généré.

**Test 3 : Analyse et correction de bug**

Prompt envoyé à chaque modèle :

```python
# Identifie le bug dans cette fonction et fournis le code corrigé complet.
def update_item(item_id: int, item: Task):
    if item.id not in db:
        raise HTTPException(status_code=404)
    db[item.id] = item
    return item
```

Critères d'évaluation : détection précise du bug, qualité de la correction, clarté de l'explication.

### Étape 2 : Définir la grille de notation

Chaque réponse est notée de 1 à 5 sur les critères suivants :

- **Exactitude** *(tests 1 et 2)* : le code est-il exécutable sans erreurs logiques ni imports manquants ?
- **Respect de la consigne** *(tests 1, 2 et 3)* : le format demandé est-il respecté, sans texte superflu autour du code ?
- **Compacité et propreté** *(tests 1 et 2)* : le code est-il minimal, sans sur-ingénierie ni verbosité inutile ?
- **Détection du bug** *(test 3)* : le problème logique est-il identifié avec précision ?
- **Qualité de la correction** *(test 3)* : la correction proposée est-elle idiomatique et conforme aux bonnes pratiques ?

La note finale de chaque modèle est la moyenne sur les trois tests.

### Étape 3 : Tester chaque modèle dans des conditions identiques

Installer les modèles via Ollama et soumettre exactement le même prompt à chaque modèle, sans reformulation :

```bash
# Installer un modèle
ollama pull qwen2.5-coder:7b

# Tester via l'API (même commande pour tous les modèles)
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5-coder:7b",
  "prompt": "votre prompt ici",
  "stream": false
}'
```

Consigner les réponses et noter chaque critère avant de passer au modèle suivant.

## Modèles évalués

Neuf modèles ont été testés, couvrant différentes tailles et spécialisations :

- `qwen2.5-coder:7b` et `qwen2.5-coder:3b` (spécialisés code, Alibaba)
- `deepseek-coder-v2:16b` et `deepseek-coder:1.3b` (spécialisés code, DeepSeek)
- `llama3:7b` (modèle généraliste, Meta)
- `codegemma:7b` et `codegemma:2b` (spécialisés code, Google)
- `mistral:7b` (modèle généraliste, Mistral AI)
- `codellama:7b` (spécialisé code, Meta)

## Résultats

### Classement global

| Modèle                  | Test 1 | Test 2 | Test 3 | Moyenne |
| ----------------------- | ------ | ------ | ------ | ------- |
| qwen2.5-coder:7b        | 4/5    | 5/5    | 5/5    | 4.6/5   |
| qwen2.5-coder:3b        | 4/5    | 4/5    | 4/5    | 4.0/5   |
| llama3:7b               | 4/5    | 4/5    | 3/5    | 3.6/5   |
| codegemma:7b            | 3/5    | 4/5    | 3/5    | 3.3/5   |
| deepseek-coder-v2:16b   | 4/5    | 3/5    | 3/5    | 3.3/5   |
| mistral:7b              | 3/5    | 3/5    | 2/5    | 2.6/5   |
| codellama:7b            | 2/5    | 2/5    | 1/5    | 1.6/5   |
| codegemma:2b            | 1/5    | 1/5    | 1/5    | 1.0/5   |
| deepseek-coder:1.3b     | 1/5    | 1/5    | 1/5    | 1.0/5   |

### Analyse des résultats

**Test 1 (FastAPI CRUD) :** `qwen2.5-coder:7b`, `qwen2.5-coder:3b`, `deepseek-coder-v2:16b` et `llama3:7b` fournissent des implémentations fonctionnelles et exécutables. Les défauts courants des modèles moins bien classés incluent l'ajout de texte explicatif autour du code et l'omission d'imports critiques.

**Test 2 (Flutter liste et détail) :** `qwen2.5-coder:7b` génère un fichier `main.dart` complet et autonome avec navigation fonctionnelle. `qwen2.5-coder:3b` fournit un résultat structurellement proche avec des simplifications acceptables. Certains modèles produisent du code avec des imports inutiles, l'omission du champ description, ou des erreurs d'indexation.

**Test 3 (Analyse de bug) :** le bug testé est l'utilisation incorrecte de `item.id` comme clé du dictionnaire au lieu de `item_id` dans la fonction `update_item`. `qwen2.5-coder:7b` et `qwen2.5-coder:3b` détectent précisément le bug et proposent une correction idiomatique. `llama3:7b` fournit une correction valide mais avec une explication moins explicite. Les modèles les moins performants conservent le bug dans leur version corrigée.

### Recommandations selon le contexte

**Usage principal (backend, frontend, debug)** : choisir `qwen2.5-coder:7b`. Meilleur score global sur les trois tests, il s'impose clairement comme le modèle de référence pour l'assistance au développement.

**Machine avec VRAM limitée (8 Go)** : choisir `qwen2.5-coder:3b`. Il offre le meilleur ratio performance / consommation VRAM et reste très compétitif face au 7B pour la plupart des tâches courantes.

**Usage polyvalent (code + rédaction + documentation)** : considérer `llama3:7b`. Modèle généraliste de qualité, il peut être mobilisé pour des tâches au-delà du code (rédaction technique, documentation, assistance à la conception).

**A éviter** : `deepseek-coder-v2:16b`. Il nécessite 24 Go de VRAM pour un gain de performance limité par rapport aux modèles 7B, ce qui ne justifie pas le coût matériel.

## Intégration dans l'IDE avec continue.dev

Une fois le modèle sélectionné, l'intégration dans VS Code se fait via l'extension **continue.dev**, qui connecte l'éditeur à l'API Ollama locale.

**1. Installer l'extension continue.dev dans VS Code :**

Rechercher `continue` dans le marketplace VS Code ou installer via la ligne de commande :

```bash
code --install-extension Continue.continue
```

**2. Configurer continue.dev pour pointer vers Ollama :**

Ouvrir le fichier de configuration (`~/.continue/config.json`) et ajouter le modèle :

```json
{
  "models": [
    {
      "title": "qwen2.5-coder:7b (local)",
      "provider": "ollama",
      "model": "qwen2.5-coder:7b",
      "apiBase": "http://localhost:11434"
    }
  ],
  "tabAutocompleteModel": {
    "title": "qwen2.5-coder:3b (autocomplete)",
    "provider": "ollama",
    "model": "qwen2.5-coder:3b",
    "apiBase": "http://localhost:11434"
  }
}
```

Utiliser le 7B pour le chat et les tâches complexes, et le 3B pour l'autocomplétion en temps réel (latence plus faible).

**3. Vérifier le fonctionnement :**

Ouvrir un fichier de code dans VS Code, sélectionner un bloc de code et appuyer sur `Ctrl+L` (Linux/Windows) ou `Cmd+L` (Mac) pour ouvrir le chat continue.dev. Le modèle doit répondre depuis l'API Ollama locale sans aucun appel réseau externe.

## Bonnes pratiques

- **Tester sur des tâches réelles.** Adapter les scénarios de benchmark au langage et au framework de l'équipe cible, les résultats peuvent différer significativement.
- **Contextualiser les requêtes.** Un modèle moyen avec un bon contexte projet surpasse souvent un grand modèle sans contexte. continue.dev permet d'inclure automatiquement les fichiers liés (imports, tests) dans la requête.
- **Prévoir une procédure de mise à jour des modèles.** L'écosystème open source évolue rapidement. Prévoir de relancer le benchmark à chaque nouvelle version majeure des modèles retenus.
- **Surveiller la consommation VRAM.** Sur une machine partagée, un modèle 7B chargé en permanence bloque la VRAM pour les autres usages. Configurer Ollama pour décharger le modèle après inactivité : `OLLAMA_KEEP_ALIVE=5m`.
