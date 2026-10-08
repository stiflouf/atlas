# ADR-065 — Fondation de gouvernance de la confidentialité

Statut : accepté
Date : 2026-10-08
Chantier : `PRIVACY_GOVERNANCE_FOUNDATION_V1`
Complète : ADR-047 (sécurisation du pilote mono-conseiller), ADR-054 (appartenance workspace), ADR-063 (maturité visite)

## Contexte

L'audit `PRIVACY_NOTICE_V1_READINESS_AUDIT` a établi un état factuel : aucune page de
confidentialité, aucune mention légale, aucun responsable du traitement structuré, aucune durée de
conservation, aucun outillage des droits des personnes. Le dépôt le traçait déjà comme dette
ouverte en trois endroits — ADR-063 (`PRIVACY_NOTICE_V1`), `docs/KNOWN_LIMITATIONS.md`
(« Aucun mécanisme RGPD outillé ») et ADR-047.

Il a aussi établi ce qui existe : treize finalités observables dans le code, un seul point de
collecte directe auprès d'une personne concernée (la signature du bon de visite), treize services
externes réellement appelés, et une architecture dont l'axe d'appartenance — `workspace_id` sur
toutes les racines métier (ADR-054) — désigne déjà, sans le nommer, qui détermine les finalités.

Ce chantier pose la fondation. Il ne publie rien, et c'est sa décision la plus importante.

## Décision 1 — Responsable du traitement métier : le workspace

```
CONTROLLER_MODEL = WORKSPACE_LEGAL_CONTROLLER
```

Pour les traitements CRM immobiliers, le responsable du traitement est la personne physique ou
morale qui utilise le workspace et détermine les finalités : conseiller indépendant ou en
entreprise individuelle, agence, autre structure professionnelle.

**DOMIORA n'est pas écrit comme responsable du traitement métier.** Ce n'est pas une prudence
rédactionnelle mais un constat : aucune entité juridique DOMIORA n'est modélisée dans le produit, et
`apps/web/src/lib/branding.ts` indique que le nom produit est « encore en cours de sécurisation
juridique ». Désigner un nom de logiciel comme responsable désignerait quelqu'un qui n'existe pas.

Le modèle doit représenter indifféremment une personne physique et une personne morale :
`controller_legal_name` reçoit « Prénom Nom » pour une entreprise individuelle comme une raison
sociale pour une société, et `controller_legal_form` reste du texte libre plutôt qu'un vocabulaire
fermé prématuré.

### Modèle SaaS futur

Lorsque l'éditeur exploitera un service pour plusieurs clients :

- **données CRM métier du client** : l'éditeur pourra agir comme sous-traitant lorsqu'il traite
  uniquement pour le compte du workspace ;
- **traitements propres de l'éditeur** : compte SaaS, facturation, sécurité propre, support,
  analytics éventuels — qualification séparée, à traiter lorsque ces fonctions existeront. Aucune
  n'existe aujourd'hui : l'audit a vérifié l'absence totale d'analytics, de télémétrie, de
  monitoring et de facturation.

Le contrat de sous-traitance n'est pas implémenté par ce chantier, et aucun document contractuel
n'existe dans le dépôt.

## Décision 2 — Matrice des bases juridiques

Vocabulaire fermé à quatre valeurs (`apps/web/src/lib/privacy/basesLegales.ts`) :
`CONTRACT_OR_PRECONTRACTUAL`, `LEGITIMATE_INTEREST`, `CONSENT`, `LEGAL_OBLIGATION`.

**Une finalité, une base principale.** Lorsqu'un domaine relève de deux bases selon le scénario, il
est scindé en deux finalités distinctes plutôt que doté de deux bases. Une finalité portant deux
bases serait indistincte, donc indéfendable. C'est pourquoi « traiter une demande entrante » et
« prospecter sortant » ne sont pas la même finalité sous deux régimes, et pourquoi les connecteurs
Google sont scindés entre les données du conseiller (contrat) et les données incidentes de tiers
présentes dans son agenda (intérêt légitime).

| Finalité | Base | Personnes |
| --- | --- | --- |
| Demande entrante, projet acquéreur, organisation de visite | `CONTRACT_OR_PRECONTRACTUAL` | acquéreur, contact |
| Mandat, gestion du bien, transaction | `CONTRACT_OR_PRECONTRACTUAL` | vendeur, acquéreur, contact |
| Transmission du dossier à l'étude notariale | `LEGAL_OBLIGATION` | vendeur, acquéreur |
| Historique relationnel, tâches, relances de service | `LEGITIMATE_INTEREST` | contact, acquéreur, vendeur, prospect |
| Bon de visite — preuve d'intervention | `LEGITIMATE_INTEREST` | visiteur |
| Communications de service | `CONTRACT_OR_PRECONTRACTUAL` | contact, acquéreur, vendeur |
| Accès au service | `CONTRACT_OR_PRECONTRACTUAL` | utilisateur |
| Sécurité du service | `LEGITIMATE_INTEREST` | utilisateur |
| Connecteurs Google du conseiller | `CONTRACT_OR_PRECONTRACTUAL` | utilisateur, conseiller |
| Données de tiers incidentes de l'agenda | `LEGITIMATE_INTEREST` | tiers incident |
| Fiscalité et rémunération du conseiller | `CONTRACT_OR_PRECONTRACTUAL` | conseiller |

**Aucune finalité V1 n'est fondée sur le consentement** : le produit n'en collecte aucun au sens du
RGPD, et une finalité qui s'en prévaudrait s'appuierait sur une preuve inexistante.

**`LEGAL_OBLIGATION` n'est jamais générique.** La seule finalité qui s'en prévaut nomme sa
sous-finalité — la constitution et la transmission du dossier nécessaire à l'acte authentique — et
indique que le texte précis applicable reste à confirmer par un juriste. Un test refuse une
obligation légale sans sous-finalité nommée.

### Bon de visite : intérêt légitime, et pas autre chose

```
BON_VISITE_LEGAL_BASIS = LEGITIMATE_INTEREST
```

Intérêt poursuivi : établir la réalité de la visite, conserver la preuve de l'intervention du
professionnel, et permettre l'établissement, l'exercice ou la défense de droits.

Ni `CONSENT`, ni `LEGAL_OBLIGATION`. Le bon de visite n'est imposé par aucun texte — l'écrire
inventerait une obligation. Et la case du formulaire n'est pas un consentement au traitement :

```
DOCUMENT_SIGNATURE_CONSENT ≠ base juridique
```

La formule présentée est « Je reconnais avoir pris connaissance du présent bon de visite, confirme
l'exactitude des informations relatives à la visite et appose volontairement ma signature. » Elle ne
mentionne aucun traitement, aucune finalité, aucun destinataire, aucune durée, aucun droit, et
personne ne l'a présentée comme une information sur un traitement de données. `DOCUMENT_SIGNATURE_CONSENT`
est donc défini **hors** du type `BaseLegale` : la confusion n'est pas seulement déconseillée, elle
n'est pas assignable.

### Communications de service

Une communication nécessaire à une demande, une visite, un mandat ou une transaction suit la base de
la finalité métier qu'elle sert. **Il n'existe pas de base « Gmail »** : Gmail est un moyen
technique, et figure parmi les prestataires, jamais parmi les finalités.

### Prospection commerciale électronique B2C

```
MARKETING_B2C_EMAIL_POLICY = NOT_SUPPORTED_WITHOUT_MARKETING_CONSENT
```

Pour un particulier prospecté par voie électronique à des fins commerciales, un consentement
préalable spécifique doit pouvoir être démontré, sauf exception juridique applicable et elle-même
démontrée. Le produit ne possède aujourd'hui aucun `marketing_consent`, aucun `opt_in`, aucun
`consent_at`, aucune provenance de consentement — vérifié colonne par colonne.

Conséquences, et elles ne sont pas négociables : cette finalité n'existe pas dans la matrice ; la
notice ne doit jamais laisser entendre que DOMIORA détient un consentement marketing ; aucune
automatisation de prospection électronique B2C n'est ajoutée par ce chantier. Futur lot :
`MARKETING_CONSENT_V1`.

### Intérêt légitime : intérêt nommé, balance non prétendue

`apps/web/src/lib/privacy/interetLegitime.ts` nomme l'intérêt poursuivi et ce qui serait perdu sans
le traitement. Ce n'est **pas** une mise en balance : nécessité, impact sur les personnes, attentes
raisonnables, garanties et alternatives moins intrusives n'ont pas été analysés.

```
LIA_STATUS = TO_BE_DOCUMENTED
```

Écrit explicitement plutôt que sous-entendu : une documentation d'intérêt se présentant comme
complète serait plus trompeuse que son absence.

## Décision 3 — Conservation

Politiques **décidées**, non appliquées. Le produit n'exécute aucune purge : ni cron, ni TTL, ni
suppression. La doctrine en vigueur reste la conservation indéfinie assumée (ADR-012 « Suppression
physique : explicitement écartée », ADR-013 « Aucune suppression en V1 »).

```
RETENTION_ENFORCEMENT_V1_LIVRE = false
```

| Catégorie | Politique | Déclencheur | Phase |
| --- | --- | --- | --- |
| `PROSPECT_MARKETING` | 3 ans | collecte **ou** dernier contact émanant du prospect | active |
| `CUSTOMER_MARKETING` | durée de la relation + 3 ans | fin de la relation | active |
| `SIGNED_VISIT_FORM` | 5 ans | signature | **archive probatoire** |
| `SESSION` | 7 jours | création de session | active (déjà appliqué) |
| `OIDC_STATE` | 10 minutes | émission de l'état | active (déjà appliqué) |
| `GOOGLE_CONNECTION` | jusqu'à déconnexion, révocation ou fermeture | — | active |
| `TRANSACTION_DOCUMENTS` | `UNDECIDED` — `BY_DOCUMENT_PURPOSE` | — | — |
| `FREE_TEXT_NOTES` | `UNDECIDED` | — | — |
| `ACTIVE_CLIENT_OR_PROJECT_DATA` | `UNDECIDED` | — | — |

Le dernier contact retenu pour un prospect est celui **émanant de lui**, jamais la dernière
sollicitation émise : relancer quelqu'un qui ne répond pas ne prolonge pas la durée pendant laquelle
on peut le relancer.

### Les cinq ans du bon de visite, et ce qu'ils ne sont pas

« 5 ans » est une **politique de conservation probatoire retenue par DOMIORA**, cohérente avec le
délai de prescription civile de droit commun. Ce n'est **pas** une durée légale obligatoire spéciale
du bon de visite — il n'en existe pas. Un contentieux en cours justifie une conservation plus
longue ; le concept de suspension de purge (`legal hold`) est documenté, non implémenté : il n'y a
ni purge à suspendre, ni marqueur de litige dans le schéma. Un test verrouille cette qualification.

### Données actives et archive probatoire

À la clôture d'une relation, **conserver l'intégralité du CRM cinq ans par défaut est refusé.** Les
données actives sortent des flux ; seules celles réellement nécessaires à une preuve, à une
obligation applicable ou à la défense de droits passent en archive probatoire — et l'archive
probatoire n'est pas une base de travail : elle n'alimente ni recherche, ni relance, ni statistique.

Les champs de **texte libre** (`interactions.contenu`, `notes_bien.contenu`,
`notes_prospect_vendeur.contenu`, `comptes_rendus_visite.retour`, `taches.contexte`) ne bénéficient
d'**aucune** archive probatoire par défaut. Leur contenu est imprévisible et rien ne démontre qu'il
soit nécessaire à une preuve. Ils relèvent de `RETENTION_ENFORCEMENT_V1`.

`UNDECIDED` est une réponse et non un trou : la catégorie existe, sa durée n'est pas tranchée, et
personne n'a le droit d'en inventer une.

## Décision 4 — Information Article 13 et Article 14

**Article 13** — données collectées directement auprès de la personne. Un seul point identifié : la
signature du bon de visite. La future notice courte devra être présentée **avant** la saisie et la
signature définitive, et entrer dans le snapshot figé comme dans le PDF par la même source unique
que le template, sans quoi l'égalité « texte présenté = texte signé = texte imprimé » cesse d'être
démontrable.

**Article 14** — données obtenues autrement : contact créé par le conseiller, acquéreur saisi par le
conseiller, prospect vendeur saisi par le conseiller, informations issues de sources externes,
tiers incidents de l'agenda. L'information devra être traçable au plus tard lors de la première
communication adressée à la personne lorsqu'une communication intervient, et à défaut selon le
délai applicable.

```
ARTICLE_13_DELIVERY = NOT_IMPLEMENTED
ARTICLE_14_DELIVERY = NOT_IMPLEMENTED
```

La modélisation de la remise de l'information et de sa version est un lot distinct :
`CONTACT_PRIVACY_INFORMATION_V1`. Aucun tracking n'est implémenté ici, et un test vérifie qu'aucune
colonne de ce type n'a été ajoutée au schéma.

## Décision 5 — Identité juridique du workspace

Treize colonnes additives et **toutes nullables** sur `workspaces` (migration
`0059_workspace_privacy_identity`) :

`controller_legal_name`, `controller_legal_form`, `controller_trade_name`,
`controller_address_line1`, `controller_address_line2`, `controller_postal_code`,
`controller_city`, `controller_country_code`, `controller_siren`, `privacy_rights_email`,
`dpo_name`, `dpo_email`, `privacy_identity_modifie_le`.

**Aucun backfill, et il n'en existe aucun d'honnête.** La migration 0057 pouvait rattacher un
historique à l'unique identité humaine présente : c'était un constat. Ici, il n'existe nulle part
dans le produit la moindre trace d'une raison sociale, d'une adresse ou d'un SIREN. Les seules
valeurs approchantes seraient `workspaces.nom` (libellé d'affichage libre),
`ATLAS_ADVISOR_DISPLAY_NAME` (nom d'affichage d'instance, avec repli « Conseiller DOMIORA ») ou le
nom du produit — aucune n'est une identité juridique. Les écrire fabriquerait un responsable du
traitement inexistant, dans les colonnes mêmes destinées à l'identifier.

Le workspace historique sort donc de cette migration avec treize colonnes à `NULL`, et c'est l'état
correct.

### Complétude : deux états, jamais confondus

`apps/web/src/lib/privacy/identiteResponsable.ts` distingue l'identité **partielle** (ce que la base
porte) de l'identité **complète** (le minimum réuni), la seconde n'étant obtenue qu'en franchissant
le prédicat de type `identiteResponsablePrete`.

Minimum pour qu'une notice soit publiable : nom légal, adresse postale exploitable (voie, code
postal, ville, pays) et adresse d'exercice des droits. Le SIREN reste facultatif — une personne
physique en entreprise individuelle peut n'en pas déclarer ici, et son absence n'empêche ni
d'identifier le responsable ni de le joindre. Le DPO reste facultatif : il n'est pas toujours requis
d'en désigner un, et l'exiger rendrait une notice impossible pour un responsable qui n'y est pas
tenu.

**Aucun repli, jamais.** Ni « DOMIORA », ni « Conseiller DOMIORA », ni `workspaces.nom` ne peuvent
tenir lieu de responsable du traitement. Une identité incomplète n'est pas affichée.

### Ce qui n'y figure pas, volontairement

Carte professionnelle et son autorité de délivrance, réseau ou enseigne de rattachement, garantie
financière, responsabilité civile professionnelle. Ces informations ne servent pas à identifier un
responsable de traitement ; elles relèvent d'une future identité d'agence ou de mentions légales
(`WORKSPACE_LEGAL_IDENTITY` / `LEGAL_NOTICE`) si elles s'avèrent nécessaires. Les ajouter ici
gonflerait ce modèle d'éléments qu'aucune notice de confidentialité n'exige.

### Contraintes : forme, jamais existence

Deux `CHECK` en base, tous deux de la forme `IS NULL OR …` : SIREN à exactement neuf chiffres, code
pays à exactement deux lettres majuscules. Ils ne peuvent donc pas échouer sur les lignes
existantes, et ils refusent une valeur malformée tout en laissant passer l'absence.

**Aucun `CHECK` d'email.** Le dépôt n'a aujourd'hui aucun pattern SQL d'email sur ses quatre
colonnes d'email existantes (`contacts.email`, `workspace_membres.email`,
`envois_email.destinataire_email`, `transmissions_dossier_notaire.destinataire_email`) ; en
introduire un ici créerait une seconde règle de forme pour la même donnée. La validation reste
applicative, et elle est volontairement minimale : une expression régulière prétendant couvrir
RFC 5322 rejetterait des adresses valides.

### Garde de rôle

`apps/web/src/lib/auth/ownerWorkspaceCourant.ts` ajoute une troisième question aux deux que le dépôt
avait déjà séparées :

```
exigerSessionAtlas()       qui est entré                             IDENTITY   (ADR-047)
exigerWorkspaceCourant()   dans quel périmètre cette personne écrit  OWNERSHIP  (ADR-054)
exigerOwnerWorkspaceCourant()  cette personne peut-elle écrire CECI  ROLE
```

Elle ne remplace ni l'une ni l'autre : elle les appelle. Elle n'est posée que sur l'identité
juridique du responsable — une donnée qui engage la structure entière face aux personnes
concernées. Le rôle est relu en base pour le couple (workspace, identité), jamais dérivé de la
session : un cookie valide sept jours prouve qu'une identité est entrée, pas ce qu'elle a le droit
d'écrire aujourd'hui.

Une garde séparée alors que `workspace_membres.role` n'accepte que `'owner'` aujourd'hui : c'est
précisément parce que ce vocabulaire s'ouvrira (ADR-054 §5 réserve `member`/`manager`/`admin` sans
les implémenter). Le jour où l'un d'eux existe, cette fonction refuse déjà.

L'écran `/parametres/confidentialite` ne prend **aucun** paramètre d'URL et l'action ne lit **aucun**
identifiant de workspace du formulaire : le périmètre est résolu côté serveur. Une écriture
inter-workspace n'est donc pas seulement refusée, elle est impossible à formuler.

## Décision 6 — Texte privacy versionné en code

```
PRIVACY_NOTICE_VERSION = domiora-privacy-v1
```

Source de vérité en code (`apps/web/src/lib/privacy/politiqueConfidentialite.ts`), sur le patron que
le dépôt a déjà éprouvé pour un texte à portée juridique : `bonVisite/templateBonVisite.ts` versionne
le texte du bon, fige le texte substitué dans un snapshot à la signature, et sert une source unique à
l'écran comme au PDF. Une notice de confidentialité a le même besoin — savoir, pour une personne
informée à une date donnée, ce qu'on lui a dit — et le versionnement en code le permet sans table ni
migration.

Y vivent les catégories de données, les finalités, les bases juridiques décidées, les catégories de
destinataires, les politiques de conservation cibles, les droits, l'autorité de contrôle et la
structure Article 13 / Article 14.

## Décision 7 — Rien n'est publié

```
PUBLIC_PRIVACY_PAGE = NOT_YET_ENABLED
SHORT_NOTICE_AT_BON_VISITE = NOT_YET_ENABLED
```

C'est la décision la plus importante de ce chantier, et c'est un choix, pas un retard.

Une notice publique énonce des durées de conservation. Le produit n'en applique aucune. Publier
« trois ans » ou « cinq ans » dans ces conditions serait un engagement que le produit n'exécute
pas — un défaut plus grave que l'absence de notice, parce qu'il est affirmatif.

S'y ajoutent trois catégories de conservation encore `UNDECIDED`, et une identité de responsable du
traitement qui n'est renseignée dans aucun workspace à la sortie de ce chantier.

`blocagesPublicationNotice()` calcule ces conditions plutôt que de les recopier : la liste se réduit
d'elle-même à mesure que les lots suivants livrent. L'écran de configuration les affiche au
propriétaire, pour que « prête pour la notice » ne soit jamais lu comme « travail terminé ».

```
DOMIORA_IS_GDPR_COMPLIANT  — cette affirmation n'est pas écrite, et ne doit pas l'être
```

## Décision 8 — Fournisseurs non activés en production

Vérifié sur l'environnement de production (lecture des noms de variables, sans leurs valeurs) :

```
PRIM_PRODUCTION           = DISABLED   (PRIM_API_KEY absente)
LLM_REDACTION_PRODUCTION  = DISABLED   (DOMIORA_REDACTION_* absentes)
```

Le service de reformulation recevrait le brouillon de message complet, le prénom du destinataire,
l'adresse du bien, la date de visite et les critères du projet, chez un fournisseur indéterminable
depuis le dépôt.

**Ne pas les activer en production avant** : qualification du fournisseur, localisation des
traitements et transferts éventuels, conditions contractuelles et accord de sous-traitance,
évaluation des données réellement transmises, et mise à jour de la notice. Aucune variable Railway
n'est touchée par ce chantier.

## Décision 9 — Données fiscales personnelles du conseiller

```
FISCAL_PERSONAL_DATA_MULTI_MEMBER = BLOCKED_BEFORE_SECOND_WORKSPACE_MEMBER
```

L'audit a confirmé ce que `schema.ts` documente déjà : `dossier_fiscal` et ses trois tables filles
portent la situation fiscale **personnelle** du conseiller — régime, TVA, revenu fiscal de référence
du foyer, nombre de parts — et leur appartenance est explicitement **non tranchée** entre workspace
et identité. ADR-054 §5 pose que l'accès est binaire : être membre d'un workspace donne accès à tout
le workspace. Rattacher ce dossier au workspace exposerait donc intégralement le revenu fiscal du
foyer du conseiller au premier assistant ajouté.

**Aucune correction n'est faite ici** : ce chantier ne touche à aucun schéma fiscal, et un test
structurel le vérifie. La décision doit être prise explicitement avant tout deuxième membre de
workspace ; l'ajout de la colonne restera additif dans les deux cas.

## Non-objectifs

Ce chantier ne fait **pas**, et c'est délibéré :

- aucune page publique de confidentialité, aucune mention légale ;
- aucune information affichée sur le bon de visite, et **aucune modification de son parcours** —
  verrouillé par un test structurel sur ses cinq fichiers, ses deux textes de consentement et sa
  version de template ;
- aucun moteur de purge, aucune suppression, aucun cron de rétention ;
- aucun consentement marketing, aucun opt-in, aucune prospection électronique B2C ;
- aucun tracking de remise d'information Article 13 ou Article 14 ;
- aucun contrat de sous-traitance Article 28 ;
- aucun outillage des droits des personnes (accès, effacement, portabilité) ;
- aucune carte professionnelle, autorité de délivrance, réseau, garantie financière ou RCP ;
- aucune mise en balance d'intérêt légitime formelle ;
- aucun changement de schéma fiscal ;
- aucune variable Railway, aucune donnée de production.

Et il n'affirme à aucun endroit que DOMIORA est conforme au RGPD.

## Chantiers suivants

| Lot | Objet |
| --- | --- |
| `RETENTION_ENFORCEMENT_V1` | appliquer réellement les durées décidées ; trancher les trois catégories `UNDECIDED` ; séparer données actives et archive probatoire. **Préalable à toute publication.** |
| `PRIVACY_NOTICE_DELIVERY_V1` | rendre et publier la notice, et la notice courte Article 13 à la signature du bon de visite |
| `CONTACT_PRIVACY_INFORMATION_V1` | modéliser la remise de l'information Article 14 et sa version |
| `MARKETING_CONSENT_V1` | consentement marketing démontrable, préalable à toute prospection électronique B2C |
| `DATA_SUBJECT_RIGHTS_V1` | outiller l'accès, la rectification, l'effacement, l'opposition, la limitation et la portabilité |
| `FISCAL_OWNERSHIP_V1` | trancher l'appartenance du dossier fiscal avant tout deuxième membre |
| `WORKSPACE_LEGAL_IDENTITY` | identité d'agence complète et mentions légales, si nécessaires |
