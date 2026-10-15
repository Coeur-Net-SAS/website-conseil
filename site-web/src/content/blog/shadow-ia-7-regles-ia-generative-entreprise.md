---
title: "Shadow IA : 7 règles pour utiliser ChatGPT & co sans faire fuiter les données de votre entreprise"
description: "Vos salariés utilisent déjà l'IA générative, souvent sans mesurer ce qu'ils partagent. Synthèse des recommandations de l'ANSSI, de la CNIL et de Cybermalveillance.gouv.fr pour encadrer ces usages."
publishDate: 2026-10-15
author: "Cœur-Net"
tags: ["Sécurité", "IA générative", "Fuite de données", "RGPD", "Bonnes pratiques", "Cybermois"]
cover: "/images/blog/shadow-ia-7-regles-ia-generative-entreprise.svg"
---

*Octobre est le **Cybermois**, le mois européen de la cybersécurité, relayé en France par Cybermalveillance.gouv.fr avec la campagne « Se cyber protéger, ce n'est pas si bête ». Nous en profitons pour parler d'un risque que nous rencontrons de plus en plus souvent chez nos clients : la « shadow IA ».*

## Une pratique qui se généralise, souvent sans en mesurer les conséquences

ChatGPT, Claude, Gemini, Copilot, Perplexity… En quelques mois, les assistants d'IA générative sont entrés dans le quotidien de très nombreux salariés. Ils les utilisent pour rédiger un e-mail, résumer un document, corriger un tableau ou déboguer du code, souvent depuis leur navigateur, avec un compte personnel et gratuit.

Le problème n'est pas l'outil, mais la façon dont il est utilisé. Beaucoup d'utilisateurs ne savent pas **où partent les données** qu'ils copient dans la conversation, **qui peut y accéder**, ni **combien de temps elles sont conservées**. Un contrat client, un fichier de prospects, un extrait de code ou un rapport interne collé « pour gagner du temps », et ce sont des informations confidentielles qui quittent l'entreprise sans que personne ne s'en rende compte.

Dans la plupart des cas, il n'y a ni malveillance ni faille technique : simplement des salariés qui veulent bien faire et aller plus vite, avec des outils accessibles à tous, dans une entreprise qui n'a fixé ni règle, ni outil autorisé.

C'est ce qu'on appelle la **shadow IA** : l'usage d'outils d'intelligence artificielle en dehors de tout cadre fixé par l'entreprise.

## Pourquoi c'est un vrai risque

Quand un salarié colle un document dans un service d'IA grand public :

- **les données sortent du système d'information de l'entreprise** et sont traitées par un tiers, souvent hors de l'Union européenne ;
- selon le service et l'abonnement utilisés, elles peuvent être **conservées, consultées ou réutilisées** par le fournisseur ;
- s'il s'agit de données personnelles (clients, patients, salariés), l'entreprise peut se retrouver face à une **violation de données au sens du RGPD**, avec une obligation de notification à la CNIL ;
- et l'entreprise ne sait souvent **pas ce qui est parti**, car elle n'a aucune trace de ces échanges.

L'ANSSI est très claire sur ce point dans son guide *Recommandations de sécurité pour un système d'IA générative* (avril 2024). Sa recommandation R34 : **« Proscrire l'utilisation d'outils d'IA générative sur Internet pour un usage professionnel impliquant des données sensibles. »**

## Les 7 règles à mettre en place

### 1. Choisir un outil autorisé plutôt qu'interdire

Interdire sans proposer d'alternative ne fonctionne pas : les besoins sont réels et l'interdiction sera contournée. Choisissez un outil validé par l'entreprise, avec une offre professionnelle qui garantit **contractuellement** que vos données ne servent pas à entraîner les modèles, et dont l'hébergement est compatible avec vos obligations. Pour les données les plus sensibles, un assistant hébergé sur votre propre infrastructure est une option.

### 2. Ne jamais y mettre de données sensibles

C'est la recommandation R34 de l'ANSSI. Concrètement, on ne colle **jamais** dans un outil d'IA, même autorisé, sans validation préalable :

- des données personnelles de clients, de patients ou de salariés ;
- des mots de passe, clés d'API, configurations ou extraits de journaux techniques ;
- du code source ou des documents qui constituent votre savoir-faire ;
- des contrats, offres ou informations financières confidentielles.

### 3. Écrire une politique d'usage simple et la faire signer

Une page suffit : outils autorisés, données interdites, ce qu'il faut faire en cas de doute, sanctions possibles. Annexez-la à votre charte informatique et faites-la signer par chaque salarié. C'est aussi ce qui vous permettra d'agir si une règle n'est pas respectée.

### 4. Bloquer techniquement les outils non autorisés

Une règle sans contrôle reste fragile. La plupart des pare-feu et des solutions de filtrage web proposent une catégorie « IA générative » : bloquez-la par défaut, ouvrez seulement l'outil validé, et gardez la trace des tentatives d'accès.

### 5. Activer la protection contre les fuites de données (DLP)

Les outils de prévention des fuites de données, intégrés notamment à Microsoft 365, permettent de détecter ou de bloquer l'envoi de documents classés sensibles, y compris vers des sites web. Commencez par vos données les plus critiques.

### 6. Sensibiliser les équipes

La plupart des fuites ne sont pas malveillantes. Expliquez simplement pourquoi ces règles existent, avec des exemples concrets. Les supports gratuits de Cybermalveillance.gouv.fr, notamment ceux du Cybermois, sont une bonne base.

### 7. Révoquer les accès le jour du départ

Un salarié qui quitte l'entreprise garde parfois pendant des jours l'accès à ses outils et aux comptes d'IA qu'il a utilisés. Une procédure de départ doit prévoir la **révocation de tous les accès le jour même**, la récupération du matériel, le changement des mots de passe partagés et, en cas de conflit, la conservation du poste avant toute réutilisation, pour préserver les preuves.

## Et si la fuite a déjà eu lieu ?

1. **Ne réinstallez pas le poste** et ne supprimez rien : les traces (historique, caches du navigateur) sont souvent les seules preuves de ce qui a été transmis.
2. **Évaluez si des données personnelles sont concernées.** Si c'est le cas, le RGPD impose de documenter la violation et, si elle présente un risque pour les personnes, de la **notifier à la CNIL dans les 72 heures** (article 33).
3. **Faites-vous accompagner** : Cybermalveillance.gouv.fr propose un diagnostic en ligne et met en relation avec des prestataires de proximité.
4. **Corrigez les causes** pour que cela ne se reproduise pas : ce sont les 7 règles ci-dessus.

## En résumé

L'IA générative est un formidable outil de productivité. Le risque ne vient pas de l'outil, mais de son usage sans cadre. Un outil autorisé, une règle écrite, un filtrage et un peu de sensibilisation suffisent à éviter l'essentiel des fuites.

Vous souhaitez faire le point sur l'usage de l'IA dans votre entreprise ou rédiger votre politique d'usage ? [Contactez-nous](/contact).

## Sources

- ANSSI, [*Recommandations de sécurité pour un système d'IA générative*](https://messervices.cyber.gouv.fr/guides/recommandations-de-securite-pour-un-systeme-dia-generative), guide ANSSI-PA-102, version 1.0, avril 2024 (recommandation R34).
- CNIL, [*Guide de la sécurité des données personnelles*](https://www.cnil.fr/fr/guide-de-la-securite-des-donnees-personnelles-nouvelle-edition-2024), édition 2024, qui intègre désormais l'intelligence artificielle.
- CNIL, [*Violations de données personnelles : les règles à suivre*](https://www.cnil.fr/fr/violations-de-donnees-personnelles-les-regles-suivre) : notification dans les 72 heures.
- Cybermalveillance.gouv.fr, [assistance aux victimes et ressources de sensibilisation](https://www.cybermalveillance.gouv.fr).
- Cybermalveillance.gouv.fr et CNIL, [*Cybermois 2026*](https://www.cnil.fr/fr/cybermois-2026).
