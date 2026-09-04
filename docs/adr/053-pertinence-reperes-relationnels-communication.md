# ADR-053 — Pertinence des repères relationnels en communication

**Statut :** Accepté
**Date :** 2026-09-04
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

VALUE-06 a introduit `reperes_relationnels_acquereur` : quatre catégories (`preference_contact`,
`preference_relationnelle`, `centre_interet`, `autre`), trois provenances
(`indique_par_le_client`, `observe_lors_d_un_echange`, `saisi_par_le_conseiller`), un libellé
libre de 200 caractères, et une case `utilisable_communication` (`NOT NULL DEFAULT false`). Ce lot
prépare la donnée ; il ne la consomme nulle part. L'audit VALUE-07A l'a vérifié plutôt que de le
supposer : six fichiers seulement référencent les repères, aucun dans `lib/communications/` ni
`lib/redaction/`, et `reperesRelationnels.frontiere.test.ts` verrouille cette limite par sentinelle
en base réelle.

La question restée ouverte est celle de la sortie : que se passe-t-il quand la case est cochée ?
Le libellé de l'interface promettait « Autoriser DOMIORA à utiliser ce repère pour personnaliser
une communication », c'est-à-dire une automatisation qui n'existait pas, et que rien n'encadrait.

Deux constats de l'audit tranchent la question.

**Les garde-fous de VALUE-05 ne protègent pas ce cas, et seraient affaiblis par lui.** Sur le
repère `centre_interet` = « Football » et l'intention `suivi_visite`, la phrase « J'espère que le
match d'hier vous a plu » franchit la totalité des huit validations de `gardeFous.ts` : aucun
balisage, aucune URL, aucun chiffre, aucun mois, aucune capitale en milieu de phrase. Elle invente
pourtant l'existence d'un match, son moment, et l'appréciation du client. Pire : `corpusAutorise()`
construit la référence de validation À PARTIR des faits autorisés — ajouter un libellé de repère
aux faits élargit mécaniquement ce que la sortie a le droit de contenir et désarme
`entite_inconnue` pour ce message. Les garde-fous protègent contre l'invention chiffrée ou
nominative ; ils ne protègent pas contre une phrase creepy entièrement textuelle.

**Aucune dérivation automatique n'est possible sans lire un texte libre.** Transformer « préfère
des messages courts » en `styleConcis = true`, ou « préfère les échanges par email » en un canal
préféré, suppose d'interpréter `libelle`. C'est exactement ce qu'ADR-008 interdit : toute règle
métier exprimable sur des champs structurés l'est, jamais comme une extraction de texte libre —
`acquereurs.notes`, `comptesRendusVisite.retour` et `taches.contexte` sont exclus pour cette
raison précise, et `reperes.libelle` est de même nature.

## Décision

### 1. Ce que `utilisableCommunication` signifie, et ne signifie pas

Le champ signifie exactement, et uniquement :

> « Ce repère peut être affiché au conseiller lors de la préparation d'une communication. »

Il ne signifie pas : un consentement RGPD, une autorisation donnée par le client, une pertinence
automatique, un droit d'envoyer le texte au fournisseur de rédaction, ni un droit d'injecter le
texte dans un message. `AUTORISÉ ≠ PERTINENT ≠ UTILISÉ` : la case n'ouvre que la première porte.

Le libellé de l'interface est resserré en conséquence (« Afficher ce repère lors de la préparation
d'une communication », avec une aide disant ce qui ne se produit pas). La colonne, le champ
TypeScript, la migration 0031, le `DEFAULT false` et les données existantes restent inchangés :
c'est la promesse qui était trop large, pas la donnée.

### 2. Un repère n'est affiché que pour l'acquéreur réellement résolu comme destinataire

La résolution reste celle de `contexteEcranCommunication.ts`, jamais une seconde logique : aucun
appariement par email, par nom ou par prénom, aucune heuristique, aucune inférence depuis le
contenu du message. Les repères appartiennent à un acquéreur (`acquereur_id` est une FK) —
`relance_prospect_vendeur`, `suivi_rdv_estimation`, `retour_vendeur_apres_visite` et
`message_notaire` n'en portent donc structurellement aucun. Les intentions mixtes
(`demande_document_manquant`, `relance_piece_a_verifier`, `message_compromis`) n'en affichent que
si le candidat effectivement retenu est un acquéreur.

Seuls les repères **actifs** (`archive_le IS NULL`, ADR-012) et **autorisés** sont affichables.

### 3. Le libellé n'est jamais interprété

`libelle` reste du texte libre, affiché tel quel, jamais réécrit. Aucune règle du produit ne le
lit pour décider quoi que ce soit : ni regex, ni mots-clés, ni `includes("email")`, ni NLP, ni
classification par un modèle, ni mapping métier. Les décisions ne lisent que des champs
structurés : `categorie`, `provenance`, `utilisableCommunication`, `archiveLe`, l'identité de
l'acquéreur et le type du destinataire.

### 4. Aucun libellé ne franchit la frontière de rédaction

Aucun libellé de repère n'entre dans `FaitsCommunication`, `FaitsPartageablesAcquereur`,
`FaitsAutorisesRedaction`, `ContexteRedactionAugmentee`, le prompt, le fournisseur, le corpus des
garde-fous, le payload de reformulation, le payload Gmail ni l'historique d'envoi.

Le bloc d'affichage est rendu côté serveur, à côté du formulaire de rédaction et jamais dedans :
les repères ne sont passés en props à aucun composant client de rédaction, et ne transitent ni par
un état React, ni par un champ caché, ni par un `FormData`, ni par la query string.

Cette frontière n'est pas « le navigateur ne voit jamais le repère » — il le voit, puisqu'il est
affiché pour être lu. Elle est : **repère affiché ≠ donnée de rédaction**.

### 5. Effets par catégorie

`preference_contact` produit un unique signal structurel, `presencePreferenceContact: boolean`,
dérivé exclusivement de `categorie === "preference_contact"`. Il déclenche une phrase neutre
(« Une préférence de contact est enregistrée. Vérifiez que le canal choisi lui correspond. »).
DOMIORA ne prétend pas savoir quel canal est préféré, ni si le canal courant le contredit :
l'affirmer demanderait de lire le libellé. Le conseiller lit le repère et tranche.

`preference_relationnelle` est affichée, sans aucun effet sur le ton. Les quatre tons existants
(`professionnel`, `cordial`, `court`, `relance_douce`) restent des choix humains — « préfère des
messages courts » a déjà sa réponse dans le produit, elle s'appelle le ton « court » et c'est le
conseiller qui la choisit.

`centre_interet` et `autre` sont affichés s'ils sont autorisés, sans aucun effet automatique.

### 6. La provenance informe, elle n'agit pas

`indique_par_le_client`, `observe_lors_d_un_echange` et `saisi_par_le_conseiller` sont affichées
pour que le conseiller apprécie l'origine de l'information — « m'a indiqué qu'il préfère l'email »
et « semble passionné de football » ne se valent pas. Aucune ne déclenche d'effet automatique, et
`indique_par_le_client` n'autorise pas davantage l'envoi du libellé au fournisseur : l'autorisation
du conseiller et la certitude du fait sont deux axes distincts, et aucun des deux n'ouvre la
frontière de rédaction.

### 7. La pertinence est déterministe, jamais confiée à un modèle

Le fournisseur de rédaction ne reçoit que ce que l'application a déjà jugé éligible. Il ne lui est
jamais demandé « ce repère est-il pertinent ici ? » : c'est un jugement relationnel humain, pas
une tâche de génération. Cette règle est cohérente avec ADR-004 (Human-in-the-Loop) et ADR-008.

## Hors périmètre, volontairement

Un champ structuré d'effet dans VALUE-06 (`effet_communication` : `aucun` / `canal` /
`style_concis`) qui permettrait une automatisation déterministe sans jamais lire le libellé —
seule voie honnête vers une personnalisation automatique, à ouvrir si et seulement si le terrain
la réclame, et par une nouvelle décision explicite. Une sélection de repères par message avec
injection du libellé au modèle. Toute classification automatique des données sensibles : le
libellé étant libre, un conseiller peut y écrire de la santé ou une situation familiale, et aucun
filtre par expression régulière ne constituerait une garantie — la protection retenue est
structurelle (rien ne sort), pas déclarative. Aucune migration, aucun changement de schéma, aucun
changement du prompt, de l'adaptateur ni du fournisseur.

## Conséquences

- Les deux listes blanches (`FaitsPartageablesAcquereur`, `FaitsAutorisesRedaction`) restent
  fermées et inchangées, ainsi que le prompt et l'adaptateur. Le test de frontière VALUE-06 reste
  vert sans modification.
- Toute future automatisation à partir d'un repère demande une nouvelle décision explicite, et
  devra de préférence reposer sur une donnée structurée plutôt que sur l'interprétation du libellé.
- Le produit assume de faire moins : DOMIORA met le repère sous les yeux du conseiller au moment
  où il écrit, au lieu de simuler une intelligence relationnelle qu'il n'a pas.

## Scalabilité

Aucun impact particulier. Une lecture supplémentaire indexée sur `acquereur_id`, uniquement quand
le destinataire résolu est un acquéreur, sur un écran ouvert à l'unité. Aucun chargement global,
aucune agrégation, aucun appel réseau ajouté.

## Réversibilité

Aucune nouvelle dépendance fournisseur. La politique est une fonction domaine pure
(`lib/relations/politiqueReperesCommunication.ts`) qui n'importe ni React, ni le protocole
d'appel, ni le fournisseur de rédaction : elle reste valable derrière un modèle européen, un
modèle auto-hébergé, ou aucun modèle du tout. Revenir en arrière consiste à ne plus rendre un
composant.
