Dossiers d'images du site
=========================

public/images/expertise/      -> 9 images, une par domaine d'expertise
public/images/realisations/   -> 7 images, une par cas client
public/images/blog/           -> 1 image par article de blog (cle "cover" dans le frontmatter)

Recommandations
---------------

- Format : JPG ou WebP (PNG accepte mais plus lourd)
- Dimensions :
    expertise et blog    : 1200 x 630 px (ratio ~16:8.4, format Open Graph)
    realisations         : 1200 x 750 px (ratio 16:10)
- Poids cible : < 200 Ko par image (utiliser https://squoosh.app pour compresser)
- Style : photos professionnelles, schemas, ou illustrations coherentes avec le ton conseil tech

Liste exacte des fichiers attendus
----------------------------------

expertise/                              [3 domaines prioritaires en tete]
  01-recherche-ia.jpg                   <- NEW : Recherche IA, biometrie, biais
  02-iam-biometrie.jpg                  <- NEW : Gestion d'identite et biometrie
  03-grc-conformite.jpg                 <- NEW : GRC, RGPD, ISO 27001/42001
  04-cloud-infra.jpg                    (anciennement 01)
  05-securite.jpg                       (anciennement 02)
  06-cicd.jpg                           (anciennement 03)
  07-ia-generative.jpg                  (anciennement 04, renumerote)
  08-administration.jpg                 (anciennement 05)
  09-financement-public.jpg             <- NEW : Aide au financement public

realisations/
  migration-cloud-souverain.jpg
  outils-metiers.jpg
  pra-kubernetes.jpg
  pipeline-applicatif.jpg
  assistant-code-souverain.jpg
  transcription-diarisation.jpg
  fido2-distance.jpg

blog/
  plan-reprise-activite-kubernetes.jpg
  assistant-code-souverain-llm-local.jpg
