# Information sur les connexions Google Calendar et Gmail

Statut : document d'information, destiné au conseiller pilote et à la rédaction de la notice.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`
Aucune modification de la configuration Google n'est faite par ce lot.

## Deux flux distincts, et ils ne se mélangent jamais

### 1. Identité Atlas — la connexion au logiciel

Scopes demandés : `openid email` (`apps/web/src/lib/auth/googleIdentite.ts:25`).

Aucun `access_type=offline`, aucun refresh token demandé ni conservé. De ce flux ne survivent que
deux valeurs, dans la session : l'identifiant `sub` et l'adresse électronique du conseiller. Un
contrôle d'allowlist conditionne l'entrée.

Ce flux ne donne accès à aucun agenda et à aucune messagerie.

### 2. Connecteurs métier — agenda et envoi de messages

Deux scopes, demandés **séparément** et jamais couplés
(`apps/web/src/lib/google/oauth.ts:7-14`) :

| Scope | Ce qu'il autorise | Route de demande |
|---|---|---|
| `https://www.googleapis.com/auth/calendar.events.readonly` | lecture des événements | `/api/auth/google/login` |
| `https://www.googleapis.com/auth/gmail.send` | envoi de messages | `/api/auth/google/gmail/login` |

Les capacités sont dérivées du scope réellement stocké, jamais de la route appelée
(`apps/web/src/lib/google/capacites.ts`).

## Ce que le logiciel fait, exactement

### Calendar — lecture seule

Deux appels seulement, tous deux en `GET` (`apps/web/src/lib/google/calendarClient.ts`) : lister
les événements d'une fenêtre, et récupérer un événement par identifiant. Aucun `POST`, `PATCH`,
`PUT` ni `DELETE` vers Calendar n'existe dans le dépôt.

Le calendrier lu est le calendrier **principal** du compte, et la fenêtre est **strictement
future** : de maintenant à sept jours (`apps/web/src/lib/google/agendaSource.ts:10`). Les
événements passés ne sont jamais lus.

Le logiciel ne crée, ne modifie et ne supprime aucun rendez-vous dans l'agenda du conseiller.

### Gmail — envoi seul

Une seule URL Gmail dans tout le dépôt : l'envoi de message
(`apps/web/src/lib/google/gmailClient.ts:3`). Aucune lecture de boîte : ni `list`, ni `get`, ni
`search`, ni `threads`, ni `labels`, ni `attachments`, ni `watch`, ni `history`.

Le logiciel ne lit aucun message reçu, ne détecte aucun accusé de réception, et n'envoie aucune
pièce jointe.

## Ce qui est conservé en base

### Connexion du conseiller — `connexions_google`

| Colonne | Contenu |
|---|---|
| `identite_sub` | identifiant du compte Google du conseiller (clé primaire) |
| `refresh_token_chiffre` | jeton de rafraîchissement, chiffré AES-256-GCM |
| `scope` | scopes effectivement accordés |
| `cree_le`, `modifie_le` | horodatages |

Le jeton d'accès n'est **jamais** stocké : il est régénéré à chaque besoin. Le chiffrement utilise
`GOOGLE_TOKEN_ENCRYPTION_KEY`, qui doit faire exactement 32 octets en base64, sinon le module
refuse de fonctionner (`apps/web/src/lib/google/connexion.ts:8-16`).

Un déchiffrement en échec est traité comme une absence de connexion, et journalisé sans secret.

### Rapprochement d'événements — `memoire_contextuelle`

L'identifiant de l'événement Google (`identifiant_externe`), le rattachement proposé à un bien ou
un client, des indices de confiance, un statut de validation, et une empreinte du contenu.

**Aucun payload Google brut n'est stocké** : ni titre, ni description, ni liste de participants, ni
corps d'événement. Le schéma l'interdit explicitement pour la table `interactions` (ADR-056).

### Journal d'envoi — `envois_email`

Destinataire, objet en clair, **empreinte** du contenu, identifiant de message Gmail, horodatages
et issue. **Le corps du message n'est jamais stocké.**

## Les personnes concernées, et il y en a deux catégories

1. **Le conseiller lui-même** — c'est son compte, son agenda, sa messagerie. Base retenue :
   exécution du contrat, pour une fonction qu'il demande.
2. **Les tiers mentionnés dans son agenda** — personnes qui apparaissent dans un événement sans
   avoir fourni l'information au conseiller, et qui peuvent ignorer que ce rapprochement a lieu.
   Base retenue : intérêt légitime. C'est la finalité dont la mise en balance est la plus délicate,
   et elle n'a pas été conduite (`LIA_STATUS = TO_BE_DOCUMENTED`).

Ces deux catégories sont deux finalités distinctes dans le code
(`CONNECTEURS_GOOGLE_CONSEILLER` et `DONNEES_TIERS_INCIDENTES_AGENDA`), précisément parce que la
personne concernée n'est pas la même.

## Déconnexion et révocation

`/api/auth/google/logout` supprime la ligne `connexions_google` et tente une révocation du jeton
auprès de Google. La révocation est « best effort » : son échec ne bloque pas la suppression
locale.

Limite réelle : **la révocation côté Google est globale.** Calendar et Gmail ne peuvent pas être
révoqués séparément depuis l'interface Google ; révoquer l'accès de l'application retire les deux.

Le conseiller peut aussi retirer l'accès depuis son compte Google, sans passer par DOMIORA. Dans ce
cas, le logiciel l'apprend au premier appel en échec : le statut de capacité affiché est optimiste,
ce n'est pas une vérification en direct.

## Ce que ce document ne couvre pas

- Aucun paramétrage Google n'est modifié par ce lot : ni projet, ni écran de consentement, ni
  scope, ni client OAuth.
- Le scope `gmail.send` est classé « Sensitive » par Google. Une vérification de l'application par
  Google peut être exigée avant un usage en production au-delà des comptes de test. [Non vérifié] —
  l'état de cette vérification pour le projet pilote n'a pas été constaté dans ce lot.

## À valider par un juriste

1. **Qualification du fournisseur de messagerie et d'agenda.** Inscrit comme prestataire technique
   avec `qualificationJuridique: "TO_VALIDATE"`. Aucun contrat de sous-traitance n'existe dans le
   dépôt.
2. **Transferts hors Union européenne.** Non évalués.
3. **Information des tiers mentionnés dans l'agenda.** Aucun moyen de les informer individuellement
   n'existe dans le produit. L'articulation avec les exceptions d'information de l'article 14 est à
   trancher.
4. **Lecture de l'agenda professionnel.** Si l'agenda principal du conseiller contient des
   événements personnels, ils sont lus par l'application dans la fenêtre de sept jours. Les
   conséquences de ce mélange n'ont pas été analysées.

## Décisions produit requises

1. **Activer ou non le connecteur Calendar pendant le pilote.** Il n'est pas requis pour le reste
   du produit. Ne pas l'activer supprime la question des tiers incidents.
2. **Activer ou non `gmail.send`.** Le mécanisme `mailto:` reste disponible et n'envoie rien depuis
   le serveur : il ouvre le client de messagerie du conseiller. C'est l'option qui transmet le moins
   de données à l'application.
3. **Agenda dédié.** Demander au conseiller pilote d'utiliser un agenda professionnel séparé de son
   agenda personnel réduirait la lecture d'événements privés. Non implémentable aujourd'hui : le
   code lit `primary` en dur.
