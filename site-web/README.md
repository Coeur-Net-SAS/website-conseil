# Site de conseil — MVP Astro

Site vitrine + blog de conseil. Stack volontairement minimale pour permettre un démarrage rapide
et une maintenance simple : **Astro** pour le rendu statique, **Tailwind CSS** pour le style,
**Markdown dans Git** pour les articles, **Formspree** pour le formulaire de contact (à brancher).

Aucun backend, aucune base de données, aucune authentification : tout vit dans le dépôt.

---

## 1. Prérequis

- **Node.js >= 18** (recommandé : 20 LTS). Vérifier avec `node -v`.
- **npm >= 9** (livré avec Node).
- Un éditeur de code (VS Code recommandé) avec l'extension officielle **Astro**.

> Sous Windows, ouvrir un terminal **PowerShell** ou **Windows Terminal** dans le dossier du projet.

## 2. Installation

Depuis ce dossier (`site-web/`) :

```bash
npm install
```

Cette commande télécharge Astro, Tailwind et leurs dépendances dans `node_modules/`.
Compter ~1-2 minutes la première fois.

## 3. Démarrer en local

```bash
npm run dev
```

Le serveur de développement démarre sur http://localhost:4321 (ou un port équivalent).
Les modifications de fichiers sont prises en compte à chaud (HMR).

## 4. Construire le site (build de production)

```bash
npm run build
```

Génère les fichiers statiques dans `dist/`. Avant le build, `astro check` vérifie le typage.

Pour prévisualiser le résultat du build :

```bash
npm run preview
```

---

## 5. Structure du projet

```
site-web/
├── astro.config.mjs        # configuration Astro (site, intégrations)
├── tailwind.config.mjs     # palette de couleurs et police
├── tsconfig.json           # configuration TypeScript
├── package.json            # dépendances et scripts npm
├── public/                 # fichiers statiques servis tels quels (favicon, robots.txt)
└── src/
    ├── components/         # composants réutilisables (Header, Footer)
    ├── content/
    │   ├── config.ts       # schéma de la collection blog (validation Zod)
    │   └── blog/           # articles en Markdown
    ├── layouts/
    │   └── BaseLayout.astro  # gabarit commun (head, header, footer)
    ├── pages/              # routage par fichier
    │   ├── index.astro            # /
    │   ├── expertise.astro        # /expertise
    │   ├── realisations.astro     # /realisations
    │   ├── a-propos.astro         # /a-propos
    │   ├── contact.astro          # /contact
    │   ├── mentions-legales.astro # /mentions-legales
    │   ├── confidentialite.astro  # /confidentialite
    │   └── blog/
    │       ├── index.astro        # /blog
    │       └── [...slug].astro    # /blog/<slug-de-l-article>
    └── styles/
        └── global.css      # styles globaux (directives Tailwind)
```

## 6. Ajouter un article de blog

1. Créer un nouveau fichier dans `src/content/blog/`, par exemple `mon-article.md`.
2. Renseigner l'en-tête YAML (frontmatter) :

   ```yaml
   ---
   title: "Titre de l'article"
   description: "Résumé court qui s'affichera dans la liste."
   publishDate: 2026-05-01
   author: "Cabinet conseil"
   tags: ["Kubernetes", "Sécurité"]
   draft: false
   ---
   ```

3. Rédiger le corps de l'article en **Markdown** classique.
4. L'article apparaît automatiquement dans `/blog` une fois le serveur relancé.
   Si `draft: true`, l'article reste invisible.

## 7. Formulaire de contact (Formspree)

Le formulaire (`src/pages/contact.astro`) est prêt mais pointe vers un identifiant placeholder.
Pour l'activer :

1. Créer un compte gratuit sur https://formspree.io.
2. Créer un nouveau formulaire et copier son **form ID** (de la forme `xyzabcde`).
3. Dans `src/pages/contact.astro`, remplacer `FORMSPREE_FORM_ID` par cet identifiant.
4. Tester l'envoi : le premier message demande une confirmation par e-mail.

Un champ `_gotcha` masqué (honeypot) bloque déjà les bots les plus simples.

## 8. Personnaliser le style

- **Couleurs et police** : `tailwind.config.mjs`. La palette `brand` (bleu) et `accent` (vert)
  est utilisée partout.
- **Styles globaux** : `src/styles/global.css`.
- **Layout commun** : `src/layouts/BaseLayout.astro` (titre, méta description, header, footer).

## 9. Déployer (à venir)

Le projet est prêt pour un déploiement statique sur **Netlify**, **Vercel**, **Cloudflare Pages**
ou n'importe quel hébergement de fichiers statiques.

Plus tard, un build dans une image Docker permettra le déploiement sur **Kubernetes** (sujet d'une
itération ultérieure ; voir la note d'architecture transmise).

## 10. Scripts npm utiles

| Commande            | Effet                                                           |
| ------------------- | --------------------------------------------------------------- |
| `npm run dev`       | Démarre le serveur de développement avec HMR.                   |
| `npm run build`     | Lance `astro check` puis `astro build` (génère `dist/`).        |
| `npm run preview`   | Sert le contenu de `dist/` pour vérifier le build.              |
| `npm run astro -- <cmd>` | Accès aux sous-commandes Astro (ex. `npm run astro -- add ...`). |

---

## 11. Notes pour la suite

- Le `site:` dans `astro.config.mjs` pointe encore sur `https://www.exemple.fr` ;
  le remplacer par le domaine définitif quand il sera connu.
- L'intégration `@astrojs/sitemap` est volontairement désactivée tant que ce domaine n'est pas
  fixé (le sitemap a besoin d'une URL réelle pour générer des liens corrects).
- Aucun secret n'est stocké dans le dépôt : tout est public et statique. Le seul élément
  externe est le formulaire Formspree, configuré côté service.


---

## 12. Lancer avec Docker

Un Dockerfile simple est fourni a la racine. Tu peux lancer le site dans un conteneur en deux commandes :

```bash
docker build -t site-conseil .
docker run --rm -p 4321:4321 site-conseil
```

Le site est alors accessible sur http://localhost:4321.

---

## 13. Images du site

Les pages Expertise, Realisations et Blog attendent des images dans `public/images/`. Les
balises `<img>` sont déjà en place : il suffit de déposer les fichiers aux bons noms et la page
les affichera (penser à recharger `npm run dev` après l'ajout).

### Liste exacte attendue

```
public/images/expertise/
  01-recherche-ia.jpg          # priorite 1 (nouveau)
  02-iam-biometrie.jpg         # priorite 2 (nouveau)
  03-grc-conformite.jpg        # priorite 3 (nouveau)
  04-cloud-infra.jpg
  05-securite.jpg
  06-cicd.jpg
  07-ia-generative.jpg
  08-administration.jpg
  09-financement-public.jpg

public/images/realisations/
  migration-cloud-souverain.jpg
  outils-metiers.jpg
  pra-kubernetes.jpg
  pipeline-applicatif.jpg
  assistant-code-souverain.jpg
  transcription-diarisation.jpg
  fido2-distance.jpg

public/images/blog/
  plan-reprise-activite-kubernetes.jpg
  assistant-code-souverain-llm-local.jpg
```

### Recommandations

- **Format** : JPG ou WebP (PNG accepté mais plus lourd).
- **Dimensions** : 1200x630 pour expertise et blog, 1200x750 pour realisations.
- **Poids** : viser < 200 Ko par image (ex. squoosh.app).
- **Alt text** : déjà rempli dans le code, à ajuster si nécessaire dans
  `src/pages/expertise.astro` et `src/pages/realisations.astro`.

### Convention pour les nouveaux articles de blog

Quand tu ajoutes un article, le code cherche par défaut `/images/blog/<slug>.jpg` (où `<slug>`
est le nom du fichier `.md` sans l'extension). Pour utiliser un autre chemin, ajoute un champ
`cover` dans le frontmatter :

```yaml
---
title: "Mon article"
publishDate: 2026-05-10
cover: /images/blog/autre-nom.png
---
```

---

## 14. Newsletter (Brevo)

Le composant `src/components/NewsletterForm.astro` affiche un formulaire d'inscription a la newsletter,
present dans le pied de page de toutes les pages (version compacte) et en bas de `/blog` (version large).

Le formulaire poste sur **Brevo** (ex-Sendinblue), service francais base a Paris, hebergement EU,
conforme RGPD. Plan gratuit : jusqu'a 300 envois / jour.

Mise en service :

1. Creer un compte sur https://www.brevo.com.
2. Aller dans **Contacts > Formulaires > Creer un formulaire**, mode HTML.
3. Recuperer l'URL d'envoi du formulaire (de la forme `https://xxx.sibforms.com/serve/MUIFAA...`).
4. Dans `src/components/NewsletterForm.astro`, remplacer la constante `BREVO_FORM_URL` par cette URL.

Tant que la constante n'est pas remplacee, le formulaire affichera quand meme bien mais l'envoi
echouera (URL invalide). Pas de risque de fuite de donnees : aucune soumission n'aboutit.
