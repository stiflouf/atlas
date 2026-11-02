# Notice d'information aux personnes — projet de texte pilote

Statut : **PROJET**. Non publié. Non remis. À valider par un juriste avant toute remise.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`
Source de vérité des décisions : `apps/web/src/lib/privacy/politiqueConfidentialite.ts`
(`PRIVACY_NOTICE_VERSION = domiora-privacy-v1`), ADR-065.

## Ce que ce document est, et ce qu'il n'est pas

C'est un **projet de texte** destiné aux personnes dont les données sont saisies dans DOMIORA
pendant le pilote : vendeurs, acquéreurs, contacts, visiteurs signataires d'un bon de visite.

Il n'est pas publié par ce lot, et ne doit pas l'être tel quel. `PUBLIC_PRIVACY_PAGE_ENABLED` et
`SHORT_NOTICE_AT_BON_VISITE_ENABLED` restent `false` dans le code, et ce lot ne les change pas.
Aucun écran, aucune route, aucun champ n'est ajouté.

Il ne contient aucune affirmation de conformité. L'énoncé « DOMIORA est conforme au RGPD » n'est
pas écrit ici et ne doit pas l'être.

## Blocage de publication encore actif

`blocagesPublicationNotice()` calcule les conditions restantes. À la date de ce document, elles
sont au nombre de deux, et la première est structurante :

1. `RETENTION_ENFORCEMENT_V1_ABSENT` — les durées de conservation sont **décidées mais non
   appliquées**. Le produit n'exécute aucune purge : ni cron, ni TTL, ni suppression automatique.
2. `POLITIQUES_CONSERVATION_UNDECIDED` — trois catégories ne sont pas tranchées
   (`TRANSACTION_DOCUMENTS`, `FREE_TEXT_NOTES`, `ACTIVE_CLIENT_OR_PROJECT_DATA`).

Conséquence directe sur la rédaction : **le projet ci-dessous n'annonce aucune durée chiffrée.**
Annoncer « trois ans » ou « cinq ans » serait un engagement que le produit n'exécute pas. Le texte
dit ce qui est vrai : la conservation court jusqu'à une suppression décidée, et une suppression
s'obtient par demande, traitée par une procédure manuelle documentée.

C'est une **décision produit** assumée, pas un oubli de rédaction. Elle est à confirmer par un
juriste : dire « jusqu'à suppression sur demande » plutôt qu'une durée est factuellement exact mais
sa recevabilité au regard de l'article 13.2.a n'a pas été évaluée.

---

# PROJET DE TEXTE — à ne pas remettre avant validation juridique

## Qui traite vos données

Le responsable du traitement est le professionnel de l'immobilier qui vous accompagne. Son
identité complète et ses coordonnées figurent en tête de la version remise de cette notice.

Elles ne sont pas pré-remplies ici : le logiciel DOMIORA n'est pas le responsable du traitement de
vos données, et aucun nom par défaut ne peut tenir cette place. Voir
`docs/pilote/IDENTITE_RESPONSABLE_TRAITEMENT.md`.

## Pourquoi vos données sont traitées

| Ce que nous faisons | Sur quel fondement |
|---|---|
| Traiter votre demande, qualifier votre projet d'acquisition, organiser les visites | Exécution du contrat ou mesures précontractuelles |
| Gérer le mandat, le bien confié et la transaction jusqu'à son terme | Exécution du contrat ou mesures précontractuelles |
| Transmettre à l'étude notariale les pièces nécessaires à l'acte authentique | Obligation légale (sous-finalité : constitution et transmission du dossier de l'acte) |
| Conserver l'historique de la relation, organiser le suivi et les relances de service | Intérêt légitime : assurer un suivi cohérent et ne pas perdre l'historique nécessaire à la continuité du service |
| Constater la réalisation d'une visite et l'intervention du professionnel (bon de visite) | Intérêt légitime : établir la réalité de la visite et permettre l'établissement, l'exercice ou la défense de droits |
| Vous adresser les communications nécessaires au traitement de votre demande | Exécution du contrat ou mesures précontractuelles |
| Rapprocher un rendez-vous d'agenda du dossier correspondant, y compris lorsqu'il vous mentionne sans que vous nous ayez fourni l'information | Intérêt légitime : préparer l'activité du conseiller |

Nous ne vous adressons **aucune prospection commerciale par voie électronique**. Le logiciel ne
dispose d'aucun mécanisme de recueil d'un consentement à cette fin, et aucune fonction de
prospection électronique n'est utilisée.

## Quelles données

Identité et coordonnées (nom, prénom, adresse électronique, téléphone) ; éléments de votre projet
(budget, critères, secteurs recherchés) ; historique de nos échanges et notes de suivi rédigées par
le conseiller ; pièces que vous nous remettez et documents de la transaction ; pour un bien confié,
son adresse et ses caractéristiques ; en cas de visite, le bon de visite, votre signature
manuscrite et le document PDF qui en résulte.

## Qui les reçoit

- L'étude notariale destinataire du dossier, pour l'établissement de l'acte.
- L'hébergeur de l'application, de la base de données et du stockage des documents, qui agit pour
  le compte du responsable du traitement.
- Le fournisseur de messagerie et d'agenda du conseiller, pour les messages qui vous sont envoyés
  et les rendez-vous de son agenda professionnel.
- Des services de données publiques interrogés pour documenter la présentation d'un bien, auxquels
  l'adresse du bien ou ses coordonnées géographiques sont transmises.

Aucun autre destinataire. Aucune donnée n'est vendue, louée ni cédée.

## Combien de temps

Vos données sont conservées pendant la durée nécessaire aux finalités ci-dessus, et au-delà
lorsqu'une pièce est nécessaire à une preuve, à une obligation applicable ou à la défense de
droits — en particulier un bon de visite signé.

Le logiciel ne procède à aucune suppression automatique. Une suppression intervient sur décision,
notamment à la suite d'une demande de votre part, selon une procédure manuelle appliquée par le
responsable du traitement.

## Vos droits

Vous disposez des droits d'accès, de rectification, d'effacement, d'opposition, de limitation et de
portabilité, dans les conditions prévues par la réglementation applicable.

Pour les exercer, écrivez à l'adresse indiquée en tête de cette notice. Votre demande est traitée
manuellement : aucun parcours automatisé n'existe dans le logiciel.

Deux limites vous sont signalées parce qu'elles sont réelles :

- Les informations figées au moment de la signature d'un bon de visite ne sont pas modifiables par
  conception : elles constituent l'instantané de ce qui vous a été présenté et signé. Une
  rectification ultérieure se fait par ajout, non par réécriture.
- Lorsqu'une pièce est nécessaire à l'établissement, à l'exercice ou à la défense de droits, en
  particulier dans le cadre d'un litige, elle peut être conservée malgré une demande d'effacement.
  Vous en êtes alors informé.

Vous pouvez introduire une réclamation auprès de la Commission nationale de l'informatique et des
libertés (CNIL).

## Origine des données

Lorsque vous ne nous avez pas fourni vos données directement, elles proviennent du professionnel
qui vous accompagne, d'une personne qui vous a mis en relation, d'une source publiquement
accessible, ou d'un rendez-vous de l'agenda professionnel du conseiller qui vous mentionne.

---

# Fin du projet de texte

## À valider par un juriste

1. **Absence de durée chiffrée.** Le texte dit « jusqu'à suppression décidée » parce que c'est
   l'état réel du produit. Recevabilité à évaluer, et formulation à arrêter.
2. **Sous-finalité d'obligation légale.** « Constitution et transmission du dossier nécessaire à
   l'acte authentique » est nommée sans citer de texte. Le texte applicable reste à confirmer, et
   la qualification en obligation légale avec lui. [Non vérifié]
3. **Base du bon de visite.** L'intérêt légitime est retenu (ADR-065 §2). Aucune mise en balance
   formelle n'a été conduite : `LIA_STATUS = TO_BE_DOCUMENTED`. Les quatre intérêts poursuivis sont
   nommés dans `apps/web/src/lib/privacy/interetLegitime.ts`, leur balance ne l'est pas.
4. **Qualification des destinataires.** Chaque catégorie porte `qualificationJuridique:
   "TO_VALIDATE"`. Aucun contrat de sous-traitance n'existe dans le dépôt pour l'hébergeur ni pour
   le fournisseur de messagerie.
5. **Transferts hors Union européenne.** Non évalués, et donc non mentionnés dans le texte. Le
   fournisseur de messagerie et d'agenda, ainsi que l'hébergeur, doivent être qualifiés sur ce
   point avant remise.
6. **Information des tiers mentionnés dans un agenda.** Le texte les couvre dans « origine des
   données », mais aucun moyen de les informer individuellement n'existe. L'articulation avec les
   exceptions d'information est à trancher.
7. **Moment de la remise.** Article 13 pour le signataire d'un bon de visite (avant signature),
   article 14 pour les personnes saisies par le conseiller. Les deux sont `NOT_IMPLEMENTED` dans le
   produit : la remise est aujourd'hui un geste humain, non tracé.

## Décisions produit requises

1. **Canal de remise pendant le pilote.** Aucun écran ne présente cette notice. Remise par pièce
   jointe à un courriel, par document papier, ou report jusqu'à `PRIVACY_NOTICE_DELIVERY_V1` : à
   trancher. Aucune option n'est implémentée.
2. **Traçabilité de la remise.** Aucune colonne ne l'enregistre, et ADR-065 interdit d'en ajouter
   hors `CONTACT_PRIVACY_INFORMATION_V1`. Pendant le pilote, la trace est tenue hors produit ou
   n'est pas tenue : à trancher explicitement.
3. **Les trois catégories de conservation `UNDECIDED`.** Elles bloquent la publication d'une notice
   avec durées. Les trancher relève de `RETENTION_ENFORCEMENT_V1`.
