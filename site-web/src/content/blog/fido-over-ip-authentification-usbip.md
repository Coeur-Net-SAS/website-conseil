---
title: "FIDO over IP : comment FIDO ne dépend que du protocole de transmission"
description: "Retour sur un PoC où nous avons authentifié un poste Windows Hello avec une clé FIDO2 déportée sur un serveur distant via USB/IP, et un servo-moteur en guise de doigt humain."
publishDate: 2026-09-04
author: "Cabinet conseil"
tags: ["Sécurité", "FIDO2", "Authentification", "USB/IP", "Windows Hello"]
cover: "/images/blog/fido-over-ip-authentification-usbip.png"
---

## Contexte et objectif

Dans le cadre du développement de notre produit, nous devions livrer un PoC de notre solution d'authentification. Nous avions déjà un module PAM pour Linux et un Credential Provider pour des machines Windows en standalone, mais il manquait une brique : une solution pour les postes Windows d'entreprise.

Évidemment, la solution était déjà toute trouvée : FIDO.

FIDO2 est un protocole éprouvé (bonjour Yubikey, Chipnet, Winkeo — on en cite toujours plusieurs pour ne pas faire de pub) et il est nativement supporté par Windows Hello, lui-même intégré à Azure AD. Le chemin semblait tout tracé : on suit la norme FIDO2, on l'implémente, et Azure AD ainsi que les postes d'entreprise nous tendent les bras.

Nous avons donc commencé à développer — en nous inspirant de solutions open source existantes comme [OpenSK](https://github.com/google/opensk) — notre propre module d'authentification FIDO2.

## Un mur nommé FIDO Alliance

Très vite, un problème de taille est apparu. Nous pouvions bien créer un authentificateur FIDO2, qu'il soit USB, NFC ou Bluetooth, mais celui-ci serait auto-certifié. Or pour notre cas d'usage — l'authentification à Windows Hello — Microsoft a fait un choix judicieux : Windows ne fait confiance qu'aux entités reconnues par la **FIDO Alliance**.

La FIDO Alliance est un regroupement d'acteurs de l'identité qui ont défini les normes FIDO et FIDO2. Elle certifie la validité des produits des constructeurs — une autorité de certification, en somme (on pourrait presque parler de « CA »).

Cette certification est coûteuse, en argent mais surtout en temps. Pour les besoins de notre PoC, il a donc fallu trouver une solution de repli. C'est en cherchant une alternative que nous avons redécouvert le nombre impressionnant de modules disponibles dans le noyau Linux. L'un d'eux a particulièrement retenu notre attention : **USB/IP**.

## USB/IP : le bricolage qui a tout changé

USB/IP est à la fois un monument à la versatilité de Linux, et un excellent exemple prouvant que ce n'est pas parce qu'on *peut* faire quelque chose qu'il *faut* le faire.

### Le principe

USB/IP encapsule les requêtes et réponses USB dans des paquets réseau, envoyés entre deux machines : celle qui possède physiquement le périphérique (le **serveur**, ou *host*) et celle qui veut l'utiliser (le **client**, ou *virtual host controller*). Côté client, le périphérique distant apparaît comme s'il était branché sur un port physique local.

### Trois briques essentielles

**Côté serveur (`usbipd`)** — Le démon `usbipd` tourne sur la machine où le périphérique est réellement branché. Il écoute sur le port TCP 3240 par défaut et attend qu'un client se connecte pour demander l'accès à un périphérique donné. Le module noyau `usbip-host` intercepte alors les échanges avec le pilote habituel du périphérique et les redirige vers la couche réseau.

**Côté client (`vhci-hcd`)** — Sur la machine cliente, le module `vhci-hcd` (*Virtual Host Controller Interface*) crée un contrôleur hôte USB virtuel. Pour le noyau client, ce contrôleur se comporte comme n'importe quel contrôleur USB physique (EHCI, XHCI...). Quand le périphérique distant est attaché, il apparaît dans `lsusb`, les pilotes correspondants se chargent normalement, et les applications l'utilisent sans rien savoir de la magie réseau sous-jacente.

**Le protocole** — Chaque URB (*USB Request Block*, l'unité de base des échanges USB) est sérialisé, envoyé sur un socket TCP, puis désérialisé côté client. Le protocole transporte les métadonnées (numéro de périphérique, endpoint, type de transfert : contrôle, bulk, interrupt, isochrone) ainsi que les données elles-mêmes.

Autrement dit : FIDO2 ne définit qu'un protocole applicatif au-dessus d'un transport USB, NFC ou BLE. Si on est capable de faire transiter des trames USB brutes sur IP de façon transparente pour le système d'exploitation, alors on transporte FIDO2 sur IP sans avoir touché une seule ligne du protocole lui-même.

## Notre architecture (diabolique)

Avant toute chose : il s'agit d'un **PoC** — *proof of concept*. En aucun cas ce montage ne devrait être utilisé en production. L'objectif était uniquement de prouver que le concept fonctionnait. À terme, la véritable trajectoire reste de développer notre propre authentificateur FIDO physique et de le faire certifier.

Ceci posé, voici le fonctionnement.

Notre serveur Cœur-Net héberge deux éléments connectés :

- une **clé FIDO** ;
- des **servo-moteurs**, chacun relié à un pin alimenté en 3 volts.

Sur ce même serveur tournent la partie serveur d'USB/IP (`usbipd`) ainsi qu'un service exposant une API REST pour piloter les servo-moteurs.

Côté poste client Windows, celui sur lequel l'utilisateur souhaite s'authentifier, deux composants sont installés :

- **usbip-win**, la partie client d'USB/IP ;
- un **service Windows** qui réagit aux différents évènements du cycle d'authentification.

USB/IP possède donc deux moitiés : le module serveur (`mod usbip`) côté Cœur-Net, et le client (`usbip-win`) côté poste Windows. Entre les deux, seuls des paquets USB bruts transitent — ni Windows Hello ni la clé FIDO n'ont conscience qu'un réseau s'est invité au milieu de la conversation.

![Schéma de l'architecture du PoC : poste client Windows avec Windows Hello et usbip-win d'un côté, serveur Cœur-Net avec le serveur USBIP, la clé FIDO et le service moteur pilotant un servo-moteur de l'autre](/images/blog/diagram1.png)

## Déroulé de l'authentification, étape par étape

1. **Windows Hello** envoie un challenge à la clé FIDO (`authenticatorGetAssertion`).
2. **usbip-win**, le client Windows d'USB/IP, reçoit ce challenge sous forme de paquets USB bruts et les relaie tels quels vers le serveur Cœur-Net, où la clé FIDO est physiquement connectée.
3. La clé, sur le serveur, répond ; la première réponse est relayée à `usbip-win` puis à Windows Hello, qui génère alors un challenge de contact. Cet évènement déclenche, via le service Windows, l'envoi d'une requête REST vers le serveur qui pilote le moteur.
4. Le **servo-moteur** bouge et vient poser le pin alimenté en électricité sur le bouton tactile de la clé FIDO.
5. La clé FIDO interprète cette alimentation comme un contact humain et procède à la résolution du challenge — elle signe l'assertion.
6. **Windows** reçoit l'assertion validée et ouvre la session.

![Diagramme de séquence de l'authentification : Windows envoie authenticatorGetAssertion relayé via la liaison USB/IP jusqu'à la clé FIDO2, qui attend un contact humain ; une requête REST GET /move déclenche le servo-moteur, qui presse le bouton de la clé ; la clé signe l'assertion, renvoyée à Windows via la même liaison USB/IP](/images/blog/fido-over-ip-sequence-authentification.svg)

Les étapes 1, 2 et 6 transitent par la liaison USB/IP ; les étapes 3 à 5, elles, n'empruntent jamais ce chemin réseau — elles se déroulent entièrement en local, entre le service qui pilote le moteur et la clé physique.

## Ce que le schéma ne dit pas

Deux précisions s'imposent :

- **Le process a été simplifié.** L'objectif n'était que de démontrer la faisabilité. Nous n'avons par exemple pas détaillé la gestion du code PIN envoyé à Windows — elle suit la même logique que celle décrite ici.
- **Tout repose sur la marge d'erreur et la vitesse de connexion.** Dans un environnement où tous les acteurs sont reliés en fibre, ce montage fonctionne. Ce n'est en revanche plus le cas dès qu'on introduit de la 4G, ou plus généralement un lien dont le temps de réponse dépasse 100 ms : FIDO2 impose des délais serrés entre le challenge et la réponse, précisément pour limiter ce genre de relais.

## Conclusion

Comme beaucoup de solutions d'authentification, les clés FIDO2 ne sont pas exemptes de failles. En théorie, une clé FIDO2 doit apporter une double authentification :

- **ce que je sais** (le code PIN de la clé) ;
- **ce que je possède** (la clé elle-même).

Ce que ce PoC montre, c'est que dans de bonnes conditions réseau, l'usage d'une clé FIDO2 peut se réduire à une authentification simple : son utilisation ne garantit plus, dans l'absolu, sa possession physique.

Cela dit, il ne s'agit pas d'une faille critique, et cela ne devrait pas dissuader les entreprises d'adopter FIDO2 comme moyen d'authentification. Pour que ce montage fonctionne, il aura tout de même fallu installer un logiciel émulant des périphériques USB sur le poste client, et faire confiance à un serveur externe en y enregistrant sa clé FIDO2. Ce n'est pas une critique du protocole en lui-même, mais la démonstration qu'avec suffisamment de shadow IT, n'importe quel système peut être détourné.

Et si cela vous inquiète, posez-vous ces deux questions : est-ce pire que de se partager des mots de passe ? Est-ce plus complexe à mettre en œuvre que de se partager des mots de passe ?
