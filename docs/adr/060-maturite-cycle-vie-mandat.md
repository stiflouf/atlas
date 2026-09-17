# ADR-060 — Maturité du Mandat : cycle de vie canonique, précédence legacy et frontières V1

**Statut :** Accepté — **PARTIELLEMENT IMPLÉMENTÉ** (2026-09-16, lot `MANDATE_LIFECYCLE_FOUNDATION_V1` ; 2026-09-17, lot `MANDATE_PARTIES_V1` : M-3 fermé).
**Date :** 2026-09-16
**Décideurs :** Steven Gausset (CEO), CTO

| Section | État |
|---|---|
| §1 précédence (writers), §2 legacy write policy (défense serveur `modifierBien`), §3 type, §4 exclusivité, §5–§8 dates / statut / résiliation, §9 renouvellement primitif sans mutation, §10 `mandatCourantDuBien`, §11 invariant applicatif (`enregistrerMandatExistant`), §12 numéro, §13 workspace + verrous (signature corrigée, `modifierMandat`, `resilierMandat`), §14 création directe, §15 `enregistrerMandatExistant` (writer), §16 migration `0044`, champs verrouillables, matrice A–T | **IMPLÉMENTÉ** |
| §2 retrait des champs legacy du formulaire d'édition (masquage UI) ; §16 bascule des lecteurs UI (`LEGACY_UI_SWITCH_TIMING`), écran « Enregistrer le mandat existant », écrans modification / résiliation | **DÉCIDÉ, lot UI** |
| §16 `parties_mandat` (M-3) : table (migration `0045`), rôles `mandant` / `representant`, writers scoped (`ajouterPartieMandat`, `retirerPartieMandat`, `modifierRolePartieMandat`), lecture jointe `listerPartiesMandat`, repointage et dédoublonnage par le moteur de fusion Contact | **IMPLÉMENTÉ** (lot `MANDATE_PARTIES_V1`, 2026-09-17) |
| renouvellement humain (verrou double, écran), automatisations, cible `mandat_id` sur les événements, connecteurs | **DÉCIDÉ, lots ultérieurs** |

Écart assumé au lot lifecycle : le masquage des champs `date_mandat` / `statut_mandat` dans
`BienFormulaire` en édition n'est pas livré (il exigerait qu'une page lise `mandats`, ce que le test
structurel « aucun écran ne lit mandats » interdit jusqu'au lot UI) ; la **défense serveur** (§2)
est, elle, livrée et testée — une édition legacy sur un bien à mandat canonique est ignorée.

> Rubriques : Contexte · Problème · Décision · Alternatives écartées · Modèle de données /
> contrats · Invariants · Conséquences · Risques · Hors périmètre · Questions ouvertes ·
> Scalabilité · Réversibilité (ADR-051).
>
> Dépend de : **ADR-055** (§F le mandat est une entité ; CAS 6/7 ; invariant 9 statut dérivé),
> **ADR-054** (appartenance : `mandats` est une feuille de `biens`), **ADR-056** (identité externe,
> `references_externes`, `champs_verrouilles`), **ADR-057/059** (standard des writers Contact :
> relecture sous verrou dans le workspace de session, autre workspace indistinguable d'introuvable),
> **ADR-014** (statut dérivé, jamais stocké), **ADR-012** (archivage, jamais de DELETE).

## Contexte

Depuis ADR-055 §F (migration `0037`, checkpoint `020dff1`), `mandats` existe : `bien_id`,
`projet_vendeur_id?`, `date_debut`, `date_fin?`, `resilie_le?`, `remplace_mandat_id?`, `cree_le`.
La table est alimentée par chaque signature (`signerMandatProspectVendeur`), dans la transaction
du bien et du jalon `mandat_signe_le`. Le statut est dérivé (`deriverStatutMandat`), jamais stocké.
Le renouvellement est modélisé (`creerMandatSuccesseur`). La provenance (ADR-056) sait déjà cibler
un mandat.

L'audit `MANDATE_MATURITY_AUDIT_V1` (2026-09-16, sur `3a83b8d`) constate que cette fondation est
écrite mais jamais lue, et qu'elle ne peut pas encore exprimer un contrat :

- **M-1 — double vérité.** `biens.date_mandat` et `biens.statut_mandat` restent la source de tous
  les écrans, du tunnel commercial, des points d'attention et du dashboard ; ils s'éditent
  (`modifierBien`) sans effet sur `mandats`, et un bien créé directement (`creerBienAction`) n'a
  aucun mandat canonique alors qu'il porte une date de mandat obligatoire.
- **M-2 — cycle de vie inexploitable.** `date_fin` et `resilie_le` n'ont aucun writer : tout mandat
  canonique est « actif » indéfiniment ; type, numéro et exclusivité n'existent pas ; un
  renouvellement laisse deux mandats « actifs ».
- **M-3 — mandants non modélisés.** Question ouverte n°1 d'ADR-055, jamais tranchée.
- **M-4 — signature non scoped.** `signerMandatProspectVendeurAction` charge le prospect sans
  filtre workspace et l'UPDATE du prospect n'est pas scoped, contrairement au standard établi par
  le domaine Contact (ADR-057/059, checkpoint `3a83b8d`).

Le domaine Contact canonique est déclaré `CLOSED` (re-audit final sur `3a83b8d`). Le Mandat est le
domaine suivant, et c'est le premier objet qu'un connecteur réseau synchronisera (ADR-055 §F).

## Problème

Rendre `mandats` mature sans trois erreurs classiques : recoder une réglementation réseau (IAD ou
autre) dans le cœur du produit ; fabriquer des faits historiques par un backfill ou un default ;
ouvrir dix chantiers (documents, automatisations, connecteurs, personnes morales, UI complète) sous
prétexte qu'ils touchent au mandat.

Cette ADR tranche **seize points structurants** (§1 à §16) et rien d'autre. Chacun est une décision
ferme : aucune des seize n'est reportée en question ouverte.

## Décision

### 1. Précédence : le mandat canonique fait autorité dès qu'il existe

**`CANONICAL_PRECEDENCE`** — pour un bien donné :

- **un mandat canonique existe** (au moins une ligne `mandats` pour ce `bien_id`) → toute lecture
  produit (fiche, liste, moteurs, dashboard) lit **exclusivement** `mandats` : statut dérivé, dates,
  type, numéro. `biens.date_mandat` et `biens.statut_mandat` ne sont plus consultés pour ce bien ;
- **aucun mandat canonique** → compatibilité legacy : les colonnes du bien sont lues telles
  quelles, avec leur vocabulaire (`actif` / `suspendu` / `expire`).

C'est l'option A de l'audit (fallback **par entité**, jamais champ par champ), la même règle que
l'identité effective d'un dossier rattaché à un Contact (ADR-057) : une seule source par bien,
décidée par la présence du mandat, jamais par la présence d'une valeur. Un mandat canonique dont le
`type` est absent affiche « non renseigné » — il ne va **pas** chercher une valeur sur le bien.

Les colonnes legacy ne sont ni supprimées ni projetées : elles deviennent, pour un bien qui a un
mandat canonique, des colonnes **mortes en lecture**, conservées pour l'historique et la
réversibilité (ADR-012, ADR-051).

### 2. Écritures legacy pendant la coexistence : jamais de dual-write silencieux

**`LEGACY_WRITE_POLICY`** — quand un mandat canonique existe pour le bien, `modifierBien` **n'écrit
plus** `date_mandat` ni `statut_mandat` : ces champs sont **retirés du formulaire** pour ce bien
(option B) et, en défense en profondeur, le writer les **ignore** s'ils arrivent quand même (les
valeurs en base restent inchangées). Toute correction contractuelle passe par les writers Mandat
(§16). Quand aucun mandat canonique n'existe, l'édition legacy reste possible et inchangée.

Écarté : C (écrire aussi le canonique) — un dual-write transformerait une saisie de bien en fait
contractuel sans que l'humain l'ait posé comme tel, et il faudrait décider quel mandat de
l'historique recevoir la valeur ; D (divergence) — c'est M-1.

### 3. Type de mandat

**`MANDATE_TYPE_VALUES`** = `simple` | `exclusif` | `semi_exclusif` — vocabulaire d'ADR-055 §F,
`CHECK` SQL, pas d'autre valeur.

**`MANDATE_TYPE_NULLABILITY`** = **nullable, sans default.** Un mandat créé avant le lot lifecycle
n'a pas de type parce que personne ne l'a saisi ; y poser `simple` affirmerait une nature
contractuelle que personne n'a constatée. Tout **nouveau writer humain** (§16) exige le type ; la
nullabilité est un état de coexistence, pas une option offerte à la saisie.

### 4. Exclusivité

**`EXCLUSIVITY_MODEL`** — **aucune colonne booléenne `exclusif`.** La nature contractuelle est
portée par `type`. Pour `semi_exclusif`, `exclusivite_jusqu_au` (date, nullable) borne la période
d'exclusivité. `CHECK` : `exclusivite_jusqu_au IS NULL OR (exclusivite_jusqu_au >= date_debut AND
(date_fin IS NULL OR exclusivite_jusqu_au <= date_fin))`. **Aucune contrainte** n'impose qu'un
`semi_exclusif` porte cette date, ni qu'un `simple`/`exclusif` ne la porte pas : le repo ne prouve
aucune règle générale, et un `CHECK` qui la figerait recoderait une convention réseau.

### 5. Signature et prise d'effet

**`SIGNATURE_EFFECTIVE_DATE_DECISION`** — `date_debut` **est** la date de prise d'effet
contractuelle. Le formulaire de signature continue de l'alimenter avec la seule date qu'il saisit.
**Aucune colonne `date_signature` en V1** : elle serait toujours égale à `date_debut` et ne
distinguerait rien (rationale déjà posé dans `schema.ts`). Cette ADR ne prétend pas que les deux
concepts coïncident universellement : le jour où une prise d'effet différée est un besoin constaté,
une colonne `signe_le` sera ajoutée par une décision dédiée, et `date_debut` gardera son sens.

Conséquence immédiate : `a_venir` est un état dérivé possible (§7), même si aucun writer ne le
produit avant cette décision future.

### 6. Date de fin

**`END_DATE_MODEL`** — `date_fin` = **terme contractuel prévu**, dernier jour couvert (inclus).
Nullable : legacy, durée indéterminée, import incomplet. Les nouveaux writers humains **la
saisissent** (directement, ou via une durée convertie en date **au moment de la saisie** — la durée
n'est jamais persistée : pas de `duree_mois`, pas de `tacite_reconduction`). Elle n'est **jamais
modifiée par une résiliation** (§8) ni par un renouvellement (§9).

### 7. Statut dérivé

Aucune colonne de statut (ADR-055 invariant 9, ADR-014). **`STATUS_DERIVATION`**, fonction pure
sur la ligne et une date `aujourdhui` (format `AAAA-MM-JJ`, comparaison lexicale), dans cet ordre :

```
si resilie_le IS NOT NULL et resilie_le <= aujourdhui     → resilie
sinon si date_debut > aujourdhui                           → a_venir
sinon si date_fin IS NOT NULL et date_fin < aujourdhui     → expire
sinon                                                      → actif
```

Bornes : `date_debut` inclus (un mandat qui commence aujourd'hui est `actif`) ; `date_fin` inclus
(un mandat qui finit aujourd'hui est encore `actif`) ; `resilie_le` inclus (résilié aujourd'hui →
`resilie`). Une résiliation datée dans le futur ne fait pas encore basculer le statut — le fait
n'est pas survenu. « Remplacé » n'est **pas** un statut de la ligne (§9).

`suspendu` **n'est pas un état canonique** : il reste un vocabulaire legacy, affiché uniquement
pour un bien sans mandat canonique. Si un vrai besoin de suspension apparaît, ce sera une décision
ultérieure.

### 8. Résiliation

**`TERMINATION_MODEL`** — `resilie_le` (existe) + `motif_resiliation` (texte court, nullable,
libre — pas d'énumération : aucun vocabulaire de motifs n'est constaté dans le produit et en fixer
un inventerait une taxonomie). **Pas d'acteur dédié, pas de document lié, pas de workflow.** Le
writer `resilierMandat(id, resilieLe, motif?)` exige `resilie_le >= date_debut` (CHECK existant),
refuse un mandat déjà résilié (idempotence : une résiliation est un fait unique), et ne touche à
rien d'autre.

**La résiliation ne modifie pas `date_fin`.** Deux faits distincts : le terme prévu et la fin
anticipée réelle. Le statut regarde `resilie_le` en priorité (§7).

### 9. Renouvellement et clôture de l'ancien

**`RENEWAL_CLOSURE_MODEL`** — option **C** : la relation `remplace_mandat_id` **suffit** à rendre
l'ancien mandat non courant. Renouveler = créer une ligne qui référence l'ancien (existant,
`creerMandatSuccesseur`), sur le même bien, **sans aucune mutation** de l'ancien : ni `date_fin`
posée d'autorité (la « veille de la prise d'effet du successeur » serait un fait fabriqué), ni
`resilie_le`, ni colonne `remplace_le`.

Le statut dérivé de l'ancien (§7) reste ce que ses dates disent — il peut rester `actif` au sens
de la ligne ; c'est la **lecture** qui le classe « remplacé » (§10), par la présence d'un
successeur. Si l'humain connaît le terme réel de l'ancien, il le saisit via `modifierMandat`
(`date_fin`) : un fait constaté, jamais déduit. Le writer de renouvellement, quand il existera,
verrouille l'ancien et le bien (§13) et refuse de renouveler un mandat déjà remplacé.

### 10. Mandat courant

**`CURRENT_MANDATE_DEFINITION`** — `mandatCourantDuBien(bienId, aujourdhui)` retourne au plus un
mandat, choisi ainsi :

1. candidats : lignes `mandats` du bien **sans successeur** (aucune ligne dont
   `remplace_mandat_id` pointe vers elle) ;
2. parmi elles, statut dérivé (§7) `actif` **ou** `a_venir` — un mandat signé qui prend effet
   demain est le mandat courant du bien, il n'y en a pas d'autre ;
3. ordre déterministe : `date_debut DESC, cree_le DESC, id DESC` ; la première ligne est le
   courant.

Aucun courant si aucune ligne ne satisfait 1–2 (bien dont tous les mandats sont expirés/résiliés,
ou bien legacy sans mandat canonique). Les lignes qui ne sont pas courantes restent **toutes
lisibles** : `listerMandatsDuBien` rend l'historique complet avec, pour chacune, le statut dérivé et
l'indicateur « remplacé par ». Un jeu de données incohérent (deux lignes non remplacées et actives,
possible sur import) est **lisible** et rendu déterministe par l'ordre ; il n'est pas réparé
silencieusement.

### 11. Unicité applicative du mandat vivant

Aucune `UNIQUE` SQL « un mandat actif par bien » : le statut est dérivé du temps, une contrainte ne
peut pas l'exprimer, et les chevauchements importés doivent rester représentables.

**`LIVE_MANDATE_WRITE_INVARIANT`** — un **writer humain standard** (signature, création directe,
« enregistrer le mandat existant ») **refuse** de créer un mandat sur un bien qui a déjà un mandat
courant (§10) ; le **renouvellement** est le seul chemin explicite qui crée un mandat alors qu'un
autre est vivant, et il le remplace. Vérifié sous verrou du bien (§13). Les données importées via un
futur connecteur pourront contenir des chevauchements, qui restent lisibles (§10).

### 12. Numéro de mandat

**`MANDATE_NUMBER_MODEL`** — `numero` : texte, nullable, **non unique** (deux réseaux numérotent
indépendamment ; un même agent peut changer de réseau), **saisi par l'humain**, jamais exigé par le
cœur. Il n'est **pas** l'identifiant d'un système externe : celui-ci est
`references_externes.id_externe` (ADR-056), par fournisseur, avec sa propre unicité. L'exigence
d'un numéro (registre des mandats) relève d'une validation de pack réseau/configuration, non
implémentée, non prouvée par le repo.

### 13. Workspace et verrous

**`MANDATE_WORKSPACE_CONTRACT`** — `mandats` reste **sans `workspace_id`** (ADR-054 §7) ; son
périmètre est celui du bien. Tout writer Mandat :

- reçoit le workspace de la **session** (`exigerWorkspaceCourant`), jamais d'un FormData ;
- **relit** dans sa transaction, `FOR UPDATE`, l'entité racine dont il part (prospect, bien, mandat
  → bien), **filtrée par ce workspace** ;
- traite un objet d'un autre workspace comme **introuvable**, publiquement indistinguable d'un id
  inconnu ;
- est vérifié par un test structurel, comme le domaine Contact.

La signature existante est **non conforme** (M-4) et sera corrigée au premier lot (§16).

**`MANDATE_LOCKING_MODEL`** — verrous de ligne, ordre déterministe, une transaction :

| geste | verrous (dans l'ordre) |
|---|---|
| signature (prospect → bien + mandat) | `prospects_vendeurs` FOR UPDATE, scoped workspace ; le bien est créé dans la même transaction, pas de verrou préalable |
| création directe d'un bien (§14) | idem : bien créé, mandat créé, même transaction |
| enregistrer le mandat existant (§15) | `biens` FOR UPDATE, scoped ; puis vérification §11 |
| modification | `mandats` FOR UPDATE, puis workspace vérifié via le bien joint |
| résiliation | `mandats` FOR UPDATE, refus si déjà résilié |
| renouvellement (lot ultérieur) | `biens` FOR UPDATE puis `mandats` (ancien) FOR UPDATE — toujours le bien d'abord, pour que création directe et renouvellement ne s'interbloquent pas |

Un double submit sur la signature reste protégé par `prospects_vendeurs.bien_id UNIQUE` en dernier
filet ; avec le verrou du prospect, le second appel trouve `mandat_signe_le` posé et refuse
proprement, sans créer de bien ni de mandat.

### 14. Création directe d'un bien

Comportement produit constaté : `/biens/nouveau` exige une **date du mandat** (`required`), pose
`statut_mandat` (`actif` par défaut), et le bien entre immédiatement en commercialisation ; les
points d'attention alertent dès que le mandat n'est pas actif. **Un bien DOMIORA est, par
construction, un bien mandaté** : il n'existe aucun flux « bien en préparation », « estimation
seule » ou « bien hors commercialisation ».

**`DIRECT_PROPERTY_CREATION_POLICY`** = **B, avec une réserve d'honnêteté** : la création directe
crée un mandat canonique dans la même transaction, à partir des seuls faits saisis (`date_debut` =
date du mandat ; `type`, `numero`, `date_fin` saisis par le formulaire enrichi — §16), **uniquement
si le statut saisi est `actif`**. Si l'humain crée un bien en le déclarant `suspendu` ou `expire`
(cas résiduel : reprise d'un historique), aucun mandat canonique n'est fabriqué — le produit ne sait
pas quand ce mandat a fini — et le bien reste en compatibilité legacy jusqu'au geste humain
« enregistrer le mandat existant » (§15). Écarté : A (un bien sans mandat serait un nouveau concept
produit que rien ne demande) ; C (deux workflows) — décision future si le besoin apparaît.

### 15. Biens legacy sans mandat canonique

**`LEGACY_MANDATE_BOOTSTRAP`** — **aucun backfill**, jamais (doctrine de la migration `0037`,
inchangée). Un bien antérieur reste lisible en compatibilité legacy (§1). Un geste humain explicite
« Enregistrer le mandat existant » (writer `enregistrerMandatExistant`, lot lifecycle ; écran au lot
UI) crée le mandat canonique à partir de ce que l'humain saisit — `date_debut` pré-remplie depuis
`biens.date_mandat` comme proposition, jamais copiée sans confirmation. Sous verrou du bien,
invariant §11.

### 16. Mandants, parties, frontières et périmètre du premier lot

**`MANDANT_GAP_PRIORITY`** — M-3 est un **P2 du domaine Mandat**, **non bloquant** pour
`MANDATE_LIFECYCLE_FOUNDATION_V1`. Le cycle de vie (dates, type, résiliation, courant, workspace)
est complet et certifiable sans mandants ; les mandants s'appuient sur un mandat qui sait se clore
et sur des Contacts stables, et forment le lot suivant. Conséquence explicite : **Mandate maturity
n'est pas `CLOSED` après le lot lifecycle** ; il le sera après `MANDATE_PARTIES_V1` au plus tôt.

**`MANDATE_PARTY_MODEL_DECISION`** = **relation dédiée `parties_mandat` : OUI** (lot
`MANDATE_PARTIES_V1`, pas ici). Un mandat peut exister sans projet vendeur (bien créé directement,
ADR-042), donc `parties_projet` ne peut pas porter la qualité de mandant ; et un mandat à un seul
Contact serait une erreur structurelle (couple, indivision). Modèle décidé, non implémenté :
`parties_mandat (id, mandat_id NOT NULL → mandats, contact_id NOT NULL → contacts, role CHECK
('mandant', 'representant'), cree_le, UNIQUE (mandat_id, contact_id))`. Rôles limités à ces deux
valeurs : `apporteur`, `notaire`, `usufruitier`, `proprietaire` ne sont soutenus par aucun usage.
Garde `verrouillerContactActif` à l'écriture (un absorbé n'est pas une destination, ADR-059 §10) ;
workspace du contact = workspace du bien, vérifié applicativement. Le **moteur de fusion Contact**
devra repointer `parties_mandat` avec dédoublonnage sur `(mandat_id, contact_id)`, exactement comme
`parties_projet` — cette extension appartient à `MANDATE_PARTIES_V1`.

**Réalisé par `MANDATE_PARTIES_V1` (2026-09-17).** Table `parties_mandat` exactement comme décidée
(migration `0045`, additive, index `parties_mandat_mandat_idx` / `parties_mandat_contact_idx`,
FK NO ACTION des deux côtés, aucun `workspace_id`, aucune contrainte « au moins un mandant »).
Writers dans `lib/partieMandatRepository.ts`, tous transactionnels et scoped par le workspace de
session (partie → mandat → bien) : `ajouterPartieMandat` (verrou du mandat PUIS
`verrouillerContactActif` — même ordre partout, aucun cycle avec le moteur de fusion qui ne
verrouille que des contacts ; refus typés `mandat_introuvable`, `contact_introuvable`,
`contact_fusionne`, `deja_partie` — un contact n'a qu'un rôle par mandat, un second rôle n'est
jamais une seconde ligne), `modifierRolePartieMandat` (mandant ↔ representant, mise à jour de la
même ligne : sans lui, corriger une erreur humaine exigerait retirer puis réajouter) et
`retirerPartieMandat` (la relation seule disparaît, jamais le contact ni le mandat). Lecture
`listerPartiesMandat(mandatId, workspaceId)` : une requête jointe `contacts`, identité canonique
incluse, aucun N+1 ; un mandat legacy sans partie rend `[]`. **Aucune partie créée
automatiquement** : ni à la signature, ni à la création directe, ni par `enregistrerMandatExistant`,
ni par le successeur ; `parties_projet` n'est jamais copiée (proposition future + décision humaine,
jamais silencieuse) ; aucun backfill. **Fusion Contact** (ADR-059) : `parties_mandat` dédoublée sur
`(mandat_id, contact_id)` AVANT le repoint — même rôle : partie de l'absorbé supprimée ; rôles
différents : priorité déterministe **`mandant` > `representant`** (`roleRetenuPartieMandat`,
`types/partieMandat.ts`, propre à ce vocabulaire) appliquée à la ligne conservée ; journal
`ids_deplaces` étendu de `partiesMandat`, `partiesMandatSupprimees`, `partiesMandatRoleCorrige`
(clés absentes des journaux antérieurs, jamais réécrits). Concurrence writer × fusion testée dans
les deux ordres : aucune partie ne reste sur un absorbé. Aucune UI, aucune Server Action, aucune
automatisation, aucune personne morale, aucune provenance dédiée, aucun `champs_verrouilles`.

**`LEGAL_ENTITY_REQUIRED_V1`** = **NO.** Une SCI ou une indivision est représentée par un Contact
humain de rôle `representant`. Aucune entité Organisation.

**`CORE_VS_NETWORK_DECISION`** :

- CORE (cette ADR, provider-agnostic) : `type`, `numero`, `date_debut`, `date_fin`,
  `exclusivite_jusqu_au`, `resilie_le`, `motif_resiliation`, `remplace_mandat_id`, `bien_id`,
  `projet_vendeur_id`, mandants (lot 2), statut dérivé, mandat courant, invariant §11.
- NETWORK / configuration (hors cœur, jamais en `CHECK`) : durées par défaut et maximales, tacite
  reconduction, préavis et période irrévocable, obligation et format du numéro, statuts propres au
  réseau (`suspendu`), workflow de signature électronique, identifiants fournisseur
  (`references_externes`).

**`MANDATE_LOCKABLE_FIELDS`** (ADR-056, `champs_verrouilles.mandat_id`) : `type`, `numero`,
`dateDebut`, `dateFin`, `exclusiviteJusquAu`. **Ni `resilieLe` ni `motifResiliation`** : la
résiliation est une commande métier, pas la projection d'un champ ; un connecteur qui apprend une
résiliation devra passer par le writer, pas par une mutation de champ. Décision révisable quand un
connecteur réel l'exigera.

**Périmètre exact de `MANDATE_LIFECYCLE_FOUNDATION_V1`** :

- Colonnes ajoutées (`LIFECYCLE_FOUNDATION_COLUMNS`) : `type`, `numero`, `exclusivite_jusqu_au`,
  `motif_resiliation`. Existantes réutilisées : `date_debut`, `date_fin`, `resilie_le`,
  `remplace_mandat_id`. **Pas** de `parties_mandat`, pas de `signe_le`, pas de statut.
- Writers (`LIFECYCLE_FOUNDATION_WRITERS`) : (1) `creerMandat` enrichi (type, numero, date_fin,
  exclusivite ; type exigé pour tout appel humain — paramètre obligatoire du writer, la nullabilité
  n'existant qu'en base pour les lignes antérieures) ; (2) `signerMandatProspectVendeur` corrigé
  (§13) et enrichi ; (3) `creerBien` direct crée le mandat (§14) ; (4) `enregistrerMandatExistant`
  (§15) ; (5) `modifierMandat` (type, numero, date_fin, exclusivite — jamais `date_debut` d'un mandat
  résilié ou remplacé) ; (6) `resilierMandat` (§8). **Le renouvellement humain n'est pas dans ce
  lot** : `creerMandatSuccesseur` existe déjà au niveau repository et suffit ; le geste, son verrou
  double et son écran viennent avec le lot UI.
- Read models (`LIFECYCLE_FOUNDATION_READ_MODELS`) : `mandatCourantDuBien` (§10) et
  `listerMandatsDuBien` enrichi (statut dérivé, « remplacé par »). Pas de liste globale, pas de
  Today, pas de page.
- UI (`LIFECYCLE_FOUNDATION_UI_SCOPE`) : **aucune page nouvelle.** Deux formulaires existants
  produisent les faits que les writers exigent : signature (`ProspectVendeurConversionFormulaire`)
  et création directe (`BienFormulaire` en création) saisissent `type` (obligatoire), `numero`
  (optionnel), `date_fin` (optionnel), `exclusivite_jusqu_au` (optionnel, pertinent pour
  `semi_exclusif`). `BienFormulaire` en modification retire `date_mandat`/`statut_mandat` quand un
  mandat canonique existe (§2). Aucun écran de résiliation ni de modification de mandat dans ce
  lot : les writers sont livrés testés, exposés à l'écran par le lot UI.
- **`LEGACY_UI_SWITCH_TIMING`** : `BienVendeurMandat`, `BienStatutAction`,
  `ProspectVendeurBienCree`, `pointsAttention` et le dashboard **ne changent pas** au lot lifecycle.
  Règle pour le lot UI suivant : ces lecteurs basculent **tous ensemble** sur
  `mandatCourantDuBien` avec fallback legacy par entité (§1) — jamais un écran canonique et l'autre
  legacy sur le même bien. Le test structurel « aucun écran ne lit `mandats` »
  (`db/mandatCanonique.structurel.test.ts`) est **inversé** à ce moment-là, pas avant.
- **`MANDATE_SIGNED_EVENT_POLICY`** : l'événement `mandat_signe` continue de cibler le prospect ;
  pas de migration vers `mandat_id` au lot lifecycle. Limitation reconnue : son index d'idempotence
  « un `mandat_signe` par prospect à vie » empêche de ré-émettre pour un renouvellement — à
  résoudre avec le lot automatisations, par une cible `mandat_id` et un nouvel index.
- **`SIGNATURE_ATOMICITY_TARGET`** : `exigerWorkspaceCourant` → transaction → `SELECT ... FROM
  prospects_vendeurs WHERE id = ? AND workspace_id = ? FOR UPDATE` → refus `introuvable` (absent ou
  autre workspace, indistinguables) ou `deja_signe` / `perdu` **relus sous verrou** → identité et
  faits du bien depuis le formulaire validé → `creerBien` → `creerMandat` (type exigé) → événement
  `mandat_signe` → commit. Tout refus après une écriture est levé, jamais retourné (rollback), sur le
  modèle de `creerEtRattacher` (ADR-055 §H, checkpoint `3a83b8d`). Double submit : un seul bien, un
  seul mandat, le perdant reçoit `deja_signe`.

## Alternatives écartées

- **Statut stocké** (`statut` colonne + transitions) : faux le lendemain d'une expiration sans
  écriture (ADR-014, ADR-055 invariant 9).
- **`date_signature` dès maintenant** : colonne toujours égale à `date_debut`, qui ne distingue
  rien.
- **Clôturer l'ancien mandat au renouvellement en posant `date_fin`** : fabrique un terme que
  personne n'a constaté ; la relation de remplacement suffit à la lecture.
- **`UNIQUE` partiel « mandat actif par bien »** : inexprimable sur un statut dérivé du temps ;
  interdirait les chevauchements importés.
- **Dual-write legacy ↔ canonique** : deux vérités écrites au lieu de deux vérités lues.
- **Réutiliser `parties_projet` pour les mandants** : un mandat sans projet vendeur n'aurait aucun
  mandant représentable ; la qualité de mandant n'est pas la participation à un projet.
- **`type` default `simple`** : invente une nature contractuelle pour les lignes antérieures.
- **Énumérer les motifs de résiliation** : aucune taxonomie constatée ; texte court suffisant.

## Modèle de données / contrats

**`LIFECYCLE_COLUMN_SEMANTICS`** (colonnes à ajouter par `PLANNED_LIFECYCLE_MIGRATION`) :

| colonne | type | nullable | default | CHECK | raison |
|---|---|---|---|---|---|
| `type` | text | oui | aucun | `IN ('simple','exclusif','semi_exclusif')` | nullable pour les lignes antérieures ; aucun default pour ne pas inventer une nature contractuelle ; exigé par les writers humains |
| `numero` | text | oui | aucun | aucun (non unique) | saisi par l'humain, jamais un id fournisseur (ADR-056) |
| `exclusivite_jusqu_au` | date | oui | aucun | `IS NULL OR (>= date_debut AND (date_fin IS NULL OR <= date_fin))` | borne d'exclusivité d'un semi-exclusif ; non imposée |
| `motif_resiliation` | text | oui | aucun | aucun | texte court, posé par `resilierMandat` uniquement |

**`PLANNED_LIFECYCLE_MIGRATION`** (réalisée : `src/db/migrations/0044_mandate_lifecycle.sql`) — strictement additive :
`ALTER TABLE mandats ADD COLUMN` × 4 ; deux `CHECK` (type, exclusivité) ; index
(`MANDATE_INDEX_DECISION`, confirmé absent du schéma actuel : aucun `index()` déclaré dans le bloc
`mandats`) : `mandats_bien_idx (bien_id)`, `mandats_projet_vendeur_idx (projet_vendeur_id)`,
`mandats_remplace_idx (remplace_mandat_id)` — le troisième sert à « sans successeur » (§10).
Aucune colonne retirée, aucune donnée modifiée, aucun backfill, aucune contrainte `NOT NULL`
nouvelle. Migration `parties_mandat` : lot `MANDATE_PARTIES_V1`, séparée.

**Contrats des writers** (`lib/mandatRepository.ts`, lot lifecycle) : `creerMandat(input,
executeur)` avec `type` obligatoire dans `NouveauMandat` ; `modifierMandat(id, input, workspaceId,
executeur)` ; `resilierMandat(id, { resilieLe, motif? }, workspaceId, executeur)` ;
`enregistrerMandatExistant(bienId, input, workspaceId, executeur)`. Tous rendent un résultat métier
discriminé (`rattache`-like : `ok` / `introuvable` / `deja_resilie` / `mandat_courant_existant`),
jamais une exception pour un refus normal ; tous lèvent pour une incohérence impossible.

## Invariants

1. `date_fin IS NULL OR date_fin >= date_debut` (existe).
2. `resilie_le IS NULL OR resilie_le >= date_debut` (existe).
3. `exclusivite_jusqu_au` dans `[date_debut, date_fin]` (nouveau CHECK).
4. `type` ∈ vocabulaire ou NULL (nouveau CHECK) ; jamais NULL sur une ligne créée par un writer
   humain postérieur au lot lifecycle (test).
5. Pas d'auto-remplacement (existe) ; un successeur porte le bien du remplacé (applicatif, existe).
6. Bien et projet d'un mandat dans le même workspace (applicatif, existe).
7. Tout writer Mandat relit sa racine sous `FOR UPDATE` dans le workspace de session ; autre
   workspace = introuvable (§13).
8. Un writer standard ne crée pas de second mandat courant sur un bien (§11).
9. Une résiliation ne modifie ni `date_fin` ni aucun autre champ ; un renouvellement ne modifie pas
   le remplacé (§8, §9).
10. Aucun `DELETE` sur `mandats` (ADR-012).
11. Aucun backfill ; aucun default qui fabrique un fait (§3, §15).
12. Lecture : un bien avec mandat canonique ne lit jamais `biens.date_mandat`/`statut_mandat` (§1).

## Conséquences

- M-1, M-2 et M-4 sont fermés par `MANDATE_LIFECYCLE_FOUNDATION_V1` ; M-3 par
  `MANDATE_PARTIES_V1` (livré le 2026-09-17). Les deux lots sont livrés ; la déclaration
  `MANDATE_MATURITY = CLOSED` reste une décision de certification distincte (audit des P2 Mandat
  restants avant UI / automatisation).
- `date_fin` et le statut dérivé rendent calculables « expire dans N jours » et « expiré » : le lot
  automatisations pourra s'y brancher sans nouvelle décision de modèle.
- Le formulaire de signature et la création directe demandent le type de mandat : un fait de plus
  saisi par l'humain, obligatoire.
- `BienFormulaire` en modification perd deux champs pour les biens à mandat canonique.
- Le test structurel « aucun écran ne lit `mandats` » survit au lot lifecycle et tombe au lot UI.

**`IMPLEMENTATION_TEST_MATRIX`** (obligatoire pour certifier le lot lifecycle) :

| # | invariant | type |
|---|---|---|
| A | création legacy-compatible : une ligne antérieure sans type reste lisible, statut dérivé `actif` | repository |
| B | `type` nullable en base pour l'ancien, jamais inventé | structurel + repository |
| C | tout writer humain exige `type` (refus sans) | repository + action |
| D | `date_fin` cohérente (CHECK) et réellement écrite par les writers | repository |
| E | exclusivité cohérente (CHECK bornes), non imposée | repository |
| F | `modifierMandat` sur actif ; refus sur résilié/remplacé pour `date_debut` | repository |
| G | `resilierMandat` : une fois, `date_fin` intacte, motif posé | repository |
| H–K | statuts `a_venir`, `actif`, `expire`, `resilie` avec bornes inclusives | pur |
| L | signature : workspace de session, prospect relu FOR UPDATE scoped | action + atomicité |
| M | cross-workspace : `introuvable`, rien créé (ni bien, ni mandat) | action |
| N | double submit signature : un bien, un mandat, perdant `deja_signe` | atomicité (concurrent) |
| O | `mandatCourantDuBien` déterministe (successeur exclu, ordre, `a_venir` inclus) | repository |
| P | aucun dual-write : `modifierBien` n'écrit pas `date_mandat`/`statut_mandat` quand un mandat canonique existe | action + structurel |
| Q | aucun backfill (les biens antérieurs restent sans mandat) | intégration |
| R | création directe `actif` → mandat canonique ; `suspendu`/`expire` → aucun | action |
| S | invariant §11 : second mandat courant refusé hors renouvellement | repository |
| T | structurel : transaction, FOR UPDATE, workspace scoped, pas de `workspaceId` depuis FormData, aucune lecture de `mandats` par un écran | structurel |

## Risques

| Risque | Probabilité | Mitigation |
|---|---|---|
| Un écran bascule sur le canonique avant les autres et montre deux vérités sur un même bien | Moyenne | `LEGACY_UI_SWITCH_TIMING` : bascule groupée au lot UI, test structurel inversé à ce moment |
| L'humain saisit un `type` faux parce qu'obligatoire | Faible | `modifierMandat` corrige ; verrou humain (`champs_verrouilles`) posé à la correction comme pour l'identité Contact |
| Chevauchements importés interprétés comme incohérence | Faible | §10 : ordre déterministe, tout reste lisible, rien n'est réparé silencieusement |
| Un connecteur voudra poser `resilie_le` comme un champ | Moyenne, différée | §16 : révisable, passe par le writer |

## Hors périmètre, volontairement

Personnes morales ; renouvellement humain et son écran (lot UI) ; écran de sélection des parties
de mandat (proposition depuis `parties_projet` + décision humaine) ;
`date_signature` ; `documents_bien.mandat_id` et type de document `resiliation` (le type `mandat`
rattaché au bien suffit) ; automatisations temporelles (`mandat_expire_bientot`, `mandat_expire`,
`mandat_resilie`), cible `mandat_id` sur `evenements_metier`, Today, cible de tâche `mandat` ;
connecteurs et signature électronique (le modèle est provider-agnostic, `references_externes` cible
déjà un mandat) ; garde « pas de visite/offre sans mandat actif » — règle produit à étudier
séparément, jamais introduite pendant la migration Mandat ; suspension canonique ; mandat
multi-biens ; commission, clauses, diagnostics, diffusion, facturation.

## Questions ouvertes

Aucune sur les seize points de cette ADR. Restent ouvertes, hors de son périmètre : le moment où une
prise d'effet différée justifiera `signe_le` ; le vocabulaire de rôle de `parties_mandat` au-delà de
`mandant`/`representant` ; la politique visite/offre sans mandat actif.

## Scalabilité

Quatre colonnes nullable et trois index sur une table qui compte de l'ordre d'une ligne par bien et
par renouvellement. `mandatCourantDuBien` est une requête indexée sur `bien_id` avec anti-jointure
sur `remplace_mandat_id` (indexé). Pour une liste de biens, le mandat courant se calcule en une
passe (`DISTINCT ON (bien_id)` après filtrage), jamais par bien. Aucun impact à 10 000 utilisateurs.

## Réversibilité

Aucune dépendance fournisseur nouvelle. Migration purement additive et réversible par `DROP COLUMN`
sans perte d'un fait antérieur ; les colonnes legacy de `biens` sont conservées intactes, donc un
retour à la lecture legacy est une décision d'application, pas une migration de données.
