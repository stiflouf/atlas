# ADR-061 — Maturité de l'Offre : cycle de vie canonique, acceptation sérialisée, précédence legacy et événements

**Statut :** Accepté — **DÉCIDÉ, NON IMPLÉMENTÉ** (lot d'implémentation : `OFFER_LIFECYCLE_FOUNDATION_V1`).
**Date :** 2026-09-18
**Décideurs :** Steven Gausset (CEO), CTO

> Rubriques : Décisions · Contexte · Problème · Décision (§1–§18) · Alternatives écartées ·
> Modèle de données / contrats · Invariants · Conséquences · Risques · Hors périmètre · Questions
> ouvertes · Scalabilité · Réversibilité (ADR-051).
>
> Dépend de : **ADR-015** (offre structurée, statut mutable en place), **ADR-016/017** (compromis,
> vente dérivée), **ADR-020** (dates et motifs de perte, vocabulaire `MotifPerte`), **ADR-044/045**
> (passage visite → offre → compromis), **ADR-047** (`UNIQUE(compromis.offre_id)`, un compromis
> `en_cours` par bien), **ADR-014/046** (statut commercial dérivé, priorité du modèle structuré sur
> le jalon legacy), **ADR-032/037** (événements métier idempotents, exécutions), **ADR-054**
> (appartenance : `offres` et `compromis` sont des feuilles de `biens`), **ADR-060** (patron de
> précédence par entité canonique > legacy, writers scoped sous verrou, imports incohérents
> lisibles jamais réparés).

## DECISIONS

| Clé | Décision |
|---|---|
| `OFFER_STATUS_SOURCE_OF_TRUTH` | la table `offres` ; `biens.offre_en_cours_le` n'est plus une source dès qu'une Offre canonique existe pour le bien |
| `OFFER_STATUSES_V1` | `en_cours` · `acceptee` · `refusee` · `retiree` · **`caduque`** (clôture post-acceptation, §3) |
| `OFFER_TRANSITION_MODEL` | writer transactionnel unique : verrou bien scoped → verrou offre → transition → `UPDATE … WHERE id AND statut = <attendu>` → événement, même transaction ; états finaux jamais mutés entre eux |
| `ACCEPTANCE_SERIALIZATION_ROOT` | le **Bien** (`SELECT … FROM biens WHERE id AND workspace_id FOR UPDATE`) — toute décision sur une offre d'un bien est sérialisée par ce verrou |
| `CONCURRENT_OFFERS_POLICY` | **Option A** : accepter A refuse automatiquement, dans la même transaction, toutes les autres offres `en_cours` du bien |
| `CONCURRENT_REJECTION_REASON` | `motif_perte = 'autre_offre_acceptee'` — nouvelle valeur du vocabulaire `MotifPerte` (extension du CHECK), jamais un texte libre ; `date_decision` = celle de l'acceptation |
| `MULTIPLE_HISTORICAL_ACCEPTANCES_POLICY` | plusieurs acceptations SUCCESSIVES par bien sont légitimes ; une acceptation ne cesse d'être active que par une clôture explicite `acceptee → caduque` (geste humain, motif + date) ; **au plus une offre `acceptee` par bien à un instant**, garantie applicative sous verrou du bien (pas d'index SQL en V1, §7) |
| `OFFER_ACCEPTANCE_ACTIVE_SEMANTICS` | « offre acceptée active » = ligne dont `statut = 'acceptee'`, tout court — pas de dérivation depuis le compromis ; l'annulation d'un compromis ne la rend ni caduque ni en cours (§13) |
| `LEGACY_OFFER_MILESTONE_POLICY` | `offre_en_cours_le` conservé, jamais supprimé, plus jamais écrit par le domaine Offre (fin du dual-write à la création) ; lu uniquement pour un bien sans AUCUNE offre canonique ; aucun fallback champ par champ |
| `LEGACY_ACTIONS_POLICY` | `marquerOffreEnCoursAction` / `retirerOffreAction` : **C** — ignorées côté serveur et masquées dès qu'une Offre canonique existe, conservées legacy-only ; `marquerCompromisSigneAction` / `annulerCompromisAction` : **C** — idem dès qu'un Compromis canonique existe (prolonge ADR-046) |
| `COMMERCIAL_STATUS_SOURCE` | une règle dérivée unique `statutCommercialBienEffectif` : `vendu` > `compromis_signe` > **`offre_acceptee`** (nouveau statut) > `offre_en_cours` > `en_commercialisation`, sur les entités canoniques ; legacy seulement en absence totale d'entité canonique du même type |
| `CANONICAL_EXISTENCE_MODEL` | présence canonique ≠ offre ouverte : un bien dont la seule offre est `refusee` est en mode canonique et n'affiche jamais un `offre_en_cours_le` legacy comme une offre en cours |
| `OFFER_EVENTS` | `offre_recue` · `offre_acceptee` · `offre_refusee` · `offre_retiree` · `offre_caduque` — un par transition, dans la transaction, idempotents par `(type, offre_id)` |
| `COMPROMISE_EVENTS` | `compromis_realise` · `compromis_annule` (en plus de `compromis_signe` existant) — idempotents par `(type, compromis_id)` (index existant) |
| `EVENT_TARGET_MODEL` | extension additive : colonne `evenements_metier.offre_id` (FK NO ACTION, nullable) comptée dans le CHECK « exactement une cible » ; `compromis_id` existe déjà ; **aucun `bien_id` dupliqué** — dérivé par `offre → bien` |
| `TASK_TARGET_MODEL` | `taches.offre_id` et `taches.compromis_id` **existent déjà** (ADR-028) : aucune colonne ajoutée ; `visite_id` non touché |
| `WORKSPACE_MODEL` | `offre → bien → workspace`, `compromis → bien → workspace` ; l'acquéreur legacy doit être du même workspace que le bien (vérifié à la création) ; autre workspace = introuvable, indistinguable d'un id inconnu ; jamais un `workspaceId` issu du formulaire |
| `COMPROMISE_REQUIRES_ACCEPTED_OFFER` | OUI quand `offre_id` est fourni (déjà le cas) ; le compromis direct sans offre (ADR-045) reste supporté |
| `COMPROMISE_CANCELLATION_REOPENS_OFFER` | NON |
| `COMPROMISE_CANCELLATION_CADUCATES_OFFER` | NON — `acceptee → caduque` est un geste humain explicite, jamais déclenché par l'annulation d'un compromis, l'expiration d'une date ou une automatisation V1 |
| `BUYER_LEGACY_BLOCKER` | NO — `offres.acquereur_id` / `compromis.acquereur_id` restent sur `acquereurs` ; pont canonique = lot ultérieur |
| `COUNTER_OFFER_V1` | NO |
| `FINANCING_V1` | NO |
| `VALIDITY_AUTO_EXPIRATION` | NO |
| `CO_BUYERS_INCLUDED` | NO |
| `AUTOMATION_INCLUDED` | NO — ce lot produit les faits, `AUTOMATION_ENGINE_GENERALIZATION_V1` les consomme |

## Contexte

Depuis ADR-015 (`offres`) et ADR-016/017 (`compromis`, vente dérivée), le tunnel commercial aval
est structuré, et ADR-047 a verrouillé le compromis en base (`UNIQUE(offre_id)`, un seul `en_cours`
par bien). Le domaine Contact est `CLOSED` (ADR-059), le domaine Mandat est `CLOSED` (ADR-060,
lots lifecycle, parties, UI canonique). L'audit transversal `CROSS_DOMAIN_PRODUCT_PRIORITY_AUDIT_V1`
(2026-09-18, sur `39987db`) a désigné l'Offre comme prochain domaine : c'est le seul objet
contractuel dont la décision peut se dédoubler et dont l'état affiché peut mentir.

### État actuel (factuel)

**`offres`** (`db/schema.ts`) — `id`, `bien_id` NOT NULL FK `biens` ON DELETE CASCADE,
`acquereur_id` NOT NULL FK **`acquereurs`** (legacy) CASCADE, `montant` integer, `date_offre` date
NOT NULL, `statut` text NOT NULL default `'en_cours'`, `date_validite`, `date_decision`,
`motif_perte`, `cree_le`. CHECK `offres_statut_check` ∈ {`en_cours`,`acceptee`,`refusee`,`retiree`} ;
CHECK `offres_motif_perte_check` sur les sept valeurs de `MOTIFS_PERTE` (ADR-020 :
`financement_refuse`, `acquereur_se_retire`, `vendeur_se_retire`, `desaccord_prix`,
`juridique_administratif`, `delai_calendrier`, `autre`). **Aucun UNIQUE, aucun index, aucun
`workspace_id`** (feuille de `biens`). Liens visites : `offre_visites (offre_id, compte_rendu_visite_id)`
UNIQUE sur la paire. Immuabilité de `montant`/`acquereur_id`/`bien_id`/`date_offre` : par
convention, aucun writer ne les modifie.

Writers : `enregistrerOffreAvecLiensEtJalon` (`lib/offreRepository.ts`) — transaction offre + liens
+ `marquerOffreEnCours(bien)` (écrit `biens.offre_en_cours_le`) ; `changerStatutOffre(id,
transition)` — `UPDATE … SET statut, date_decision, motif_perte WHERE id = ?` **sans condition de
statut, sans transaction, sans verrou** ; la garde « déjà finale » vit dans
`changerStatutOffreAction` (`actions/offre.ts`), par une lecture séparée. Accepter ne touche ni
les autres offres du bien ni `offre_en_cours_le`. Aucun `workspaceId` reçu par les repositories
offre/compromis ; `changerStatutOffreAction` n'appelle pas `exigerWorkspaceCourant`.

**`compromis`** — `id`, `bien_id` NOT NULL CASCADE, `acquereur_id` NOT NULL FK `acquereurs`,
`offre_id` nullable FK `offres` ON DELETE SET NULL, `prix_convenu`, `date_signature` NOT NULL,
`date_acte`, `date_acte_reelle`, `date_annulation`, `motif_annulation`, `statut` default
`'en_cours'` ∈ {`en_cours`,`realise`,`annule`}. **`UNIQUE(offre_id)`** (`compromis_offre_id_unique`)
et **index unique partiel `compromis_bien_id_en_cours_unique` sur `(bien_id) WHERE statut =
'en_cours'`** (ADR-047). `ajouterCompromisAction` : garde applicative « un en_cours par bien », si
`offre_id` fourni → même bien, même acquéreur, `statut = 'acceptee'`, non déjà utilisée ;
transaction compromis + `marquerCompromisSigne(bien)` + événement `compromis_signe` ; erreurs de
contrainte traduites. Le compromis direct sans offre est supporté (ADR-045). Transitions
`realise` (exige `date_acte_reelle`) / `annule` (date + motif) depuis `en_cours` uniquement,
sans verrou ; aucune ne touche l'offre d'origine ni `compromis_signe_le`.

**`biens`** — jalons ADR-014 `offre_en_cours_le`, `compromis_signe_le` (timestamps nullables), sans
`vendu_le`. `deriverStatutCommercial(bien, compromis[])` (`lib/statutCommercialBien.ts`) : `vendu`
(compromis `realise` + `date_acte_reelle`) > `compromis_signe` (tout compromis non annulé ; jalon
legacy uniquement si zéro compromis structuré, ADR-046) > `offre_en_cours` **uniquement depuis
`biens.offre_en_cours_le`, jamais depuis `offres`** > `en_commercialisation`. Quatre actions legacy
(`actions/statutCommercialBien.ts` : `marquerOffreEnCoursAction`, `retirerOffreAction`,
`marquerCompromisSigneAction`, `annulerCompromisAction`) restent exposées dans `BienStatutAction`.

**`evenements_metier`** — types : `visite_realisee`, `rdv_estimation_realise`, `mandat_signe`,
`compromis_signe`, `inactivite_prospect_vendeur`,
`compatibilite_bien_acquereur_devenue_compatible`. Cibles : `compte_rendu_visite_id`,
`prospect_vendeur_id`, `compromis_id`, `(bien_id, acquereur_id)` ; CHECK « exactement une cible » ;
index uniques partiels par cible, dont `evenements_metier_compromis_unique (type_evenement,
compromis_id)`. **Aucune cible `offre_id`, aucun événement Offre, aucun `compromis_realise` /
`compromis_annule`.**

**`taches`** — sept cibles FK CASCADE, dont **`offre_id` et `compromis_id` déjà présents**
(ADR-028) ; CHECK « au plus une cible ».

## Problème

1. **O-1 — décision non atomique.** Lecture de garde puis `UPDATE WHERE id` : deux acceptations
   concurrentes de la même offre, ou une acceptation après un refus, passent toutes les deux.
2. **O-2 — aucune exclusivité.** Plusieurs offres `acceptee` sur un même bien restent possibles ;
   la seule exclusivité est en aval, au compromis.
3. **O-3 — deux vérités.** « Offre en cours » se lit dans `biens.offre_en_cours_le`, écrit à la
   création et jamais à la décision : refuser ou retirer toutes les offres laisse un badge fantôme,
   et quatre actions manuelles écrivent le même fait que le modèle structuré.
4. **O-4 — aucun fait émis.** Ni l'offre ni la fin d'un compromis n'émettent d'événement :
   Today/Automation ne peuvent rien orchestrer sur le tunnel aval.
5. **O-5 — acquéreur legacy.** `acquereur_id` pointe `acquereurs`, sans pont Contact/projet.
6. **O-6 — périmètre.** Lectures et écritures offre/compromis non filtrées par le workspace.

Cette ADR tranche **dix-huit points** (§1–§18), sans refondre le Compromis, sans migrer
l'acquéreur, sans automatisation.

## Décision

### 1. Vocabulaire canonique et état initial

`OFFER_STATUSES_V1` = `en_cours` | `acceptee` | `refusee` | `retiree` | **`caduque`**. Les quatre
premiers sont ceux d'ADR-015/020, inchangés. `caduque` est ajouté (extension du CHECK
`offres_statut_check`) pour une seule raison, développée en §6 : une acceptation doit pouvoir
cesser d'être active **sans réécrire le fait qu'elle a eu lieu**.

Toute offre créée par le produit naît `en_cours` (default SQL conservé, écrit explicitement par le
writer) ; aucun statut implicite. Un import externe qui créerait directement une offre finale est
hors périmètre (ADR-056 ne cible pas encore l'offre).

### 2. Matrice de transitions

| Depuis | Vers | Geste | Faits posés | Événement |
|---|---|---|---|---|
| `en_cours` | `acceptee` | humain | `date_decision` | `offre_acceptee` |
| `en_cours` | `refusee` | humain **ou système** (§5) | `date_decision`, `motif_perte` | `offre_refusee` |
| `en_cours` | `retiree` | humain | `date_decision`, `motif_perte` | `offre_retiree` |
| `acceptee` | `caduque` | humain | `date_decision` (de la caducité), `motif_perte` | `offre_caduque` |

Tout le reste est interdit : `refusee`/`retiree`/`caduque` sont terminaux ; `acceptee` ne devient
jamais `refusee` ni `retiree` (le passé ne se réécrit pas) ; aucun retour vers `en_cours`. Une
erreur de saisie sur une offre finale se corrige par une **nouvelle offre** (montant, date), jamais
par mutation — même discipline qu'ADR-015 (« une nouvelle proposition = une nouvelle ligne »).

`date_decision` de la caducité écrase-t-elle celle de l'acceptation ? **Non** : la ligne garde une
seule `date_decision` ; celle de l'acceptation reste lisible dans l'événement `offre_acceptee`
(horodaté, immuable). La colonne porte la **dernière** décision, le journal porte toutes.

### 3. Atomicité : un writer transactionnel unique

Toute transition passe par **un seul writer** du repository (`deciderOffre`, nom indicatif),
jamais par un `UPDATE` isolé :

```
BEGIN
  1. SELECT … FROM biens WHERE id = offre.bien_id AND workspace_id = <session> FOR UPDATE
  2. SELECT … FROM offres WHERE id = ? FOR UPDATE      (relecture du statut réel)
  3. invariants : offre du bien verrouillé, statut attendu, bien/acquéreur non archivés,
     transition autorisée (§2), politique concurrentes (§4-5)
  4. UPDATE offres SET statut, date_decision, motif_perte
     WHERE id = ? AND statut = <statut attendu>            ← garde de défense (§3 bis)
     (0 ligne → la transaction rend un résultat typé, jamais un succès)
  5. offres concurrentes (§4) : même UPDATE conditionnel, une par une, par id croissant
  6. événements (§9), un par ligne modifiée, dans la transaction
COMMIT
```

La garde `WHERE statut = <attendu>` est **conservée sous verrou** : elle ne sert plus à
sérialiser (le verrou du bien le fait) mais à rendre impossible, par construction, un `UPDATE` qui
écraserait un état final — défense en profondeur, comme les gardes `WHERE statut = 'planifiee'`
de `visites` (ADR-040). Résultats typés (union discriminée, patron Mandat) : `decidee`,
`introuvable` (inconnu **ou** autre workspace, indistinguables), `deja_finalisee` (statut final
existant, retourné avec le statut réel), `transition_interdite`, `bien_archive`,
`acquereur_archive`, `acceptation_active_existante` (§6). Aucune erreur SQL brute ne sort du
writer.

### 4. Acceptation d'offres concurrentes — Option A

Bien B, offres A et B `en_cours`, l'humain accepte A : **A devient `acceptee` et toutes les autres
offres `en_cours` du bien deviennent `refusee` dans la même transaction**, avec
`motif_perte = 'autre_offre_acceptee'` et la `date_decision` de l'acceptation. Un événement
`offre_refusee` est émis pour chacune.

Pourquoi A et non B (offres restant ouvertes) ni C (résolution manuelle préalable) : une seule
offre peut être engagée vers un compromis (ADR-045/047) ; laisser des offres `en_cours` à côté
d'une `acceptee` maintient exactement l'état contradictoire qu'O-3 rend visible ; exiger le
nettoyage préalable ajoute un geste sans décision nouvelle (le conseiller qui accepte A a déjà
tranché). L'UI annonce le nombre d'offres qui seront refusées **avant** confirmation — le fait
n'est jamais silencieux, il est explicite et journalisé.

### 5. Motif des offres refusées par la politique

Nouvelle valeur `autre_offre_acceptee` ajoutée à `MOTIFS_PERTE` (`types/motifPerte.ts`) et au
CHECK `offres_motif_perte_check`. Elle est **réservée au système** : `changerStatutOffreAction`
la refuse en saisie humaine (une personne qui refuse à la main choisit un motif humain). Le
vocabulaire reste fermé : jamais de texte libre, jamais de motif déduit. Le CHECK de
`compromis.motif_annulation` n'est pas étendu (un compromis ne s'annule pas « parce qu'une autre
offre a été acceptée »).

### 6. Une seule offre acceptée active par bien, et l'histoire

**Invariant** : à tout instant, un bien a **au plus une** offre `statut = 'acceptee'`. Garantie
**applicative sous verrou du bien** (§3) : accepter B alors qu'une A est `acceptee` rend
`acceptation_active_existante` avec l'id de A. Pas d'index unique partiel SQL en V1 (§7).

**Histoire** : A acceptée, puis le compromis échoue (annulé) ou l'acquéreur se rétracte avant
compromis, puis B doit pouvoir être acceptée. Trois options étaient possibles :

- A. « active » dérivée du compromis (acceptee sans compromis annulé) — écartée : ne couvre pas la
  rétractation avant compromis (le bien reste bloqué), et fait dépendre l'état d'une offre d'une
  jointure que ni l'invariant ni l'UI ne peuvent lire simplement.
- B. **état de clôture post-acceptation `caduque`** — retenue.
- C. événement d'annulation d'acceptation sans changement d'état — écartée : l'invariant « une
  acceptee par bien » deviendrait invérifiable sans relire le journal.

Donc : une acceptation cesse d'être active par le geste humain explicite `acceptee → caduque`
(motif du vocabulaire, date). Le fait « A a été acceptée le J » reste dans l'événement
`offre_acceptee` ; la ligne dit « n'est plus engagée ». Après un compromis annulé, l'UI **propose**
de rendre l'acceptation caduque ; elle ne le fait jamais seule (§13).

### 7. Pas d'index SQL en V1, imports incohérents lisibles

Un index unique partiel `(bien_id) WHERE statut = 'acceptee'` serait la traduction naturelle de
§6. Il n'est **pas** posé au lot V1 : (a) des lignes historiques peuvent déjà porter plusieurs
`acceptee` sur un même bien (O-2 était possible depuis ADR-015) et la migration échouerait ou
exigerait un backfill destructif, tous deux refusés ; (b) le patron Mandat (ADR-060 §11) a déjà
tranché la même question : un jeu incohérent importé reste **lisible**, jamais réparé
silencieusement, et les writers humains empêchent toute **nouvelle** incohérence. La lecture
(§11) tolère plusieurs `acceptee` : ordre déterministe (`date_decision DESC, cree_le DESC, id
DESC`), première ligne = offre acceptée présentée, les autres visibles dans la liste. L'index
pourra être posé par une ADR de reprise, une fois les données vérifiées.

### 8. `offres` est la source de vérité d'« offre en cours »

Un bien a une offre en cours **si et seulement si** `EXISTS offres WHERE bien_id = ? AND statut =
'en_cours'`. Une offre `acceptee` **n'est pas** « en cours » : la décision est prise, le bien entre
dans une sémantique d'engagement (`offre_acceptee`, §10). `biens.offre_en_cours_le` cesse d'être
lu dès qu'une offre canonique existe.

### 9. Événements métier

`OFFER_EVENTS` = `offre_recue` (création), `offre_acceptee`, `offre_refusee` (humain ou §4),
`offre_retiree`, `offre_caduque`. `COMPROMISE_EVENTS` = `compromis_realise`, `compromis_annule`
(`compromis_signe` existe). Chaque événement est émis **dans la transaction** du writer qui pose
le fait, par `emettreEvenementEtPreparerExecutions` (ADR-032), donc idempotent par index unique
partiel et jamais émis sans écriture réussie. `realise` garde son vocabulaire (signature de l'acte
effective, ADR-017).

Cible : colonne additive **`evenements_metier.offre_id`** (FK `offres` NO ACTION, nullable),
ajoutée au CHECK « exactement une cible », avec index unique partiel `(type_evenement, offre_id)
WHERE offre_id IS NOT NULL` — les transitions sont terminales, donc ponctuelles, une occurrence par
type et par offre. `compromis_realise`/`compromis_annule` réutilisent `compromis_id` et son index.
**Aucun `bien_id` dupliqué** sur ces événements : le bien se dérive par `offre → bien` ; poser les
deux violerait le CHECK « une seule cible » comme pour toute autre cible dédiée. Le contexte
bien/acquéreur nécessaire à une règle est résolu par la règle (patron `suivi_apres_visite`).

### 10. Statut commercial du bien : une règle, cinq états

`StatutCommercial` gagne **`offre_acceptee`** (« Offre acceptée ») : sans lui, une offre acceptée
sans compromis ne peut être rendue que par `offre_en_cours` (faux, §8) ou `en_commercialisation`
(faux). Ordre de priorité, sur les entités canoniques :

1. `vendu` — un compromis `realise` avec `date_acte_reelle` ;
2. `compromis_signe` — un compromis non annulé ;
3. `offre_acceptee` — une offre `acceptee` ;
4. `offre_en_cours` — une offre `en_cours` ;
5. `en_commercialisation`.

Le legacy n'intervient **que par entité absente** : `compromis_signe_le` uniquement si le bien n'a
aucun compromis canonique (règle ADR-046 inchangée) ; `offre_en_cours_le` uniquement si le bien n'a
aucune offre canonique. Un bien dont la seule offre est `refusee` reste en mode canonique Offre :
il est `en_commercialisation` (ou au-dessus par le compromis), **jamais** `offre_en_cours` par le
vieux timestamp — c'est le point critique (`CANONICAL_EXISTENCE_MODEL`), identique à « canonique
résilié n'affiche jamais le Actif legacy » d'ADR-060.

### 11. Read model de coexistence

Un helper unique, `chargerEtatOffresBien(bien, workspaceId)` (nom indicatif, patron
`chargerPresentationMandatBien`), rend :

```
| { mode: "canonique"; offresEnCours: Offre[]; offreAcceptee?: Offre; offres: Offre[] }
| { mode: "legacy"; offreEnCoursLe?: string }
| { mode: "aucun" }
```

`mode` dépend de l'**existence** d'au moins une offre canonique pour le bien (toutes statuts
confondus), pas de l'existence d'une offre ouverte. `statutCommercialBienEffectif(bien, etatOffres,
compromis[])` remplace `deriverStatutCommercial` comme seule règle (§10) ; les listes qui affichent
le statut le calculent en **batch** (une requête agrégée par lot de biens), jamais par bien.

### 12. Jalon legacy et actions legacy

`LEGACY_OFFER_MILESTONE_POLICY` : `biens.offre_en_cours_le` (a) est conservé (historique,
réversibilité ADR-051) ; (b) n'est **plus écrit** par la création d'offre — fin du dual-write
d'ADR-015 ; (c) n'est lu qu'en mode `legacy` (§11) ; (d) aucun backfill, aucune remise à NULL.

`LEGACY_ACTIONS_POLICY` — les quatre actions de `actions/statutCommercialBien.ts` :

| Action | Décision | Comportement |
|---|---|---|
| `marquerOffreEnCoursAction` | **C** | ignorée (résultat générique, aucune écriture) et masquée dès qu'une Offre canonique existe ; conservée pour un bien sans offre canonique |
| `retirerOffreAction` | **C** | idem ; le refus « compromis signé » reste |
| `marquerCompromisSigneAction` | **C** | ignorée et masquée dès qu'un Compromis canonique existe (ADR-046 ne faisait que prioriser la lecture ; ce lot ferme aussi l'écriture) |
| `annulerCompromisAction` | **C** | idem |

Un seul writer par fait commercial : dès que l'entité canonique existe, seuls ses writers écrivent
son état. `BienStatutAction` reçoit le mode de chaque entité depuis la page (props), jamais
découvert dans le composant (patron `BienFormulaire.mandatCanonique`).

### 13. Compromis : préconditions, concurrence, annulation

- **Précondition** : un compromis créé avec `offre_id` exige `offre.statut = 'acceptee'`, même bien,
  même acquéreur, même workspace — déjà le cas, conservé. Le **compromis direct sans offre** reste
  supporté (ADR-045) : rien n'est cassé.
- **Concurrentes** : par §4, au moment de créer un compromis depuis A, aucune autre offre du bien
  n'est `en_cours` ; l'invariant est déjà tenu à l'acceptation, le writer Compromis ne le refait
  pas.
- **Verrous** : le writer Compromis verrouille le bien (scoped) **puis** l'offre, dans cet ordre —
  le même que §3 ; les deux writers ne peuvent pas s'interbloquer.
- **Annulation** : `compromis_annule` **ne rouvre pas** l'offre acceptée (`COMPROMISE_CANCELLATION_REOPENS_OFFER = NO`)
  et ne la rend pas caduque : l'acceptation reste un fait ; la remise en commercialisation est le
  geste humain `acceptee → caduque` (§6), que l'UI propose après annulation. Après annulation, le
  statut commercial effectif (§10) rend `offre_acceptee` tant que A est `acceptee`, puis
  `en_commercialisation` (ou `offre_en_cours` s'il reste des offres ouvertes) — jamais un
  timestamp legacy restauré.
- **`realise`/`annule`** : transitions mises sous le même patron (verrou compromis, `UPDATE …
  WHERE statut = 'en_cours'`, événement) ; aucun autre changement du Compromis.

### 14. Workspace

`offres` et `compromis` restent des feuilles sans `workspace_id` (ADR-054 §7). Toute lecture et
toute écriture touchée par le lot remonte à `biens.workspace_id` par jointure ; l'acquéreur legacy
doit appartenir au même workspace que le bien (`acquereurs.workspace_id`, vérifié à la création
d'offre et de compromis, comme `ajouterPartieProjet`). Autre workspace = introuvable. Aucun
`workspaceId` n'est jamais lu depuis un `FormData`.

Readers à scoper : `getOffreById`, `listerOffresPourBien`, `listerOffresPourAcquereur`,
`listerOffresEnCoursPourPaire`, `getCompromisById`, `listerCompromisPourBien`,
`listerCompromisPourAcquereur`, `getCompromisParOffreId`, `listerLiensPourBien`,
`getLienOffreVisite`, `listerRemunerationsPourBien` (exposé par la fiche bien), le read model §11 et
les agrégats du dashboard qui lisent `compromis` (`prixConvenu` des ventes). Writers à scoper :
`enregistrerOffreAvecLiensEtJalon`, `deciderOffre` (accepter / refuser / retirer / caduque),
`lierVisiteAOffre` / `retirerLienVisiteOffre`, `enregistrerCompromis` (via `ajouterCompromisAction`),
`marquerCompromisRealise`, `marquerCompromisAnnule`, `modifierDateActeCompromis`.

### 15. Ordre de verrous et matrice de concurrence

`LOCK_ORDER` = **bien (scoped) → offre cible → offres concurrentes par id croissant**. Le verrou
du bien sérialise toutes les décisions sur ses offres et la création de ses compromis.

| Scénario | Attendu |
|---|---|
| T1 accepte A, T2 accepte B (même bien) | une seule gagne ; la perdante relit l'état sous verrou et rend `acceptation_active_existante` (si A gagne, B est déjà `refusee` : `deja_finalisee`) |
| T1 accepte A, T2 accepte A | une transition, un événement ; la seconde rend `deja_finalisee` avec `statut: "acceptee"` |
| accepter après `refusee`/`retiree`/`caduque` | `deja_finalisee`, aucune résurrection |
| T1 refuse A, T2 accepte A | un seul gagnant, un seul événement |
| T1 retire A, T2 accepte A | idem |
| accepter A pendant qu'un compromis se crée depuis B | sérialisé par le bien : le compromis exige B `acceptee`, donc A n'était pas acceptable (`acceptation_active_existante`) |
| double submit création d'offre | deux lignes (ADR-044 : doublon de paire signalé, confirmable) — inchangé |

### 16. Création d'offre

Le writer transactionnel existant est conservé et complété : workspace scoped (bien et acquéreur
du même workspace), statut `en_cours` explicite, événement `offre_recue`, liens visites préservés,
**plus aucune écriture de `biens.offre_en_cours_le`** (§12). La garde ADR-044 (doublon de paire
`en_cours` confirmable) reste applicative.

### 17. Ce qui ne change pas

- **Acquéreur legacy** (`BUYER_LEGACY_BLOCKER = NO`) : `offres.acquereur_id` et
  `compromis.acquereur_id` restent sur `acquereurs` ; le pont vers Contact / projet acquéreur est un
  lot ultérieur, indépendant du cycle de vie. Aucun co-acquéreur, aucune table `parties_offre`.
- **Conditions, financement, contre-offre, validité** : P3 produit. `date_validite` reste
  informative : **aucune expiration automatique** ; une automatisation future pourra détecter
  `en_cours AND date_validite < today` et proposer un geste, jamais muter l'offre.
- **Auditabilité** : les événements horodatés suffisent (un par transition) ; pas de table
  `offre_transitions`.
- **Provenance** (`references_externes`, `champs_verrouilles`) : l'offre n'y entre pas — aucun
  connecteur Offre n'est prévu.
- **Compromis** : pas de refonte ; §13 seulement.

### 18. Frontière avec l'automatisation

`OFFER_LIFECYCLE_FOUNDATION_V1` **produit** les faits (`offre_*`, `compromis_realise`,
`compromis_annule`) et les cibles (`offre_id` sur les événements ; `offre_id`/`compromis_id` déjà
sur les tâches). Il n'ajoute **aucune règle** au catalogue, ne touche ni Today, ni le scanner
temporel, ni la clôture des tâches obsolètes : tout cela appartient à
`AUTOMATION_ENGINE_GENERALIZATION_V1`, qui consommera ces faits.

## Alternatives écartées

- **Dériver « offre en cours » du timestamp legacy en gardant `offres` additive** (ADR-015) :
  c'est O-3 ; la question « plusieurs offres actives, laquelle compte ? » est désormais tranchée
  (§4, §8).
- **Option B (concurrentes laissées `en_cours`)** et **option C (résolution préalable)** : §4.
- **`acceptee → refusee` pour libérer un bien** : réécrit l'histoire ; remplacé par `caduque`.
- **« Active » dérivée du compromis** : §6, option A.
- **Index unique partiel `WHERE statut = 'acceptee'` en V1** : §7 (imports, backfill).
- **`bien_id` dupliqué sur les événements Offre** : viole le CHECK « une seule cible » ; dérivable.
- **Table `offre_transitions`** : redondante avec les événements.
- **Fusionner le lot avec la migration acquéreur → Contact** : deux chantiers, deux risques.
- **Statut `expiree`** : aucune expiration automatique décidée ; le vocabulaire n'est pas
  ouvert pour un écrivain qui n'existe pas.

## Modèle de données / contrats

Migration **additive** attendue au lot V1 (une seule) :

```
offres
  CHECK offres_statut_check      : + 'caduque'
  CHECK offres_motif_perte_check : + 'autre_offre_acceptee'
  index offres_bien_idx (bien_id), offres_acquereur_idx (acquereur_id)   -- lecteurs réels

evenements_metier
  + offre_id uuid NULL REFERENCES offres(id)   (NO ACTION, append-only)
  CHECK evenements_metier_type_check : + 'offre_recue','offre_acceptee','offre_refusee',
                                        'offre_retiree','offre_caduque',
                                        'compromis_realise','compromis_annule'
  CHECK une_seule_cible              : + (case when offre_id is not null then 1 else 0 end)
  + uniqueIndex evenements_metier_offre_unique (type_evenement, offre_id) WHERE offre_id IS NOT NULL

taches            : aucun changement (offre_id, compromis_id existants)
biens             : aucun changement (offre_en_cours_le conservé)
compromis         : aucun changement de schéma
```

Aucun backfill, aucune colonne retirée, aucun `workspace_id` ajouté.

Contrats (indicatifs) : `deciderOffre(offreId, transition, workspaceId, executeur?) →
ResultatDecisionOffre` (§3) ; `TransitionOffre` = `{ statut: "acceptee"; dateDecision } | { statut:
"refusee" | "retiree" | "caduque"; dateDecision; motifPerte }` ; `chargerEtatOffresBien` (§11) ;
`statutCommercialBienEffectif` (§10) ; `MOTIFS_PERTE` + `autre_offre_acceptee` (interdit en saisie
humaine) ; `TypeEvenementMetier` + 7 types ; `StatutCommercial` + `offre_acceptee`.

## Invariants

1. Une offre naît `en_cours` ; seules les transitions de §2 existent ; les états finaux ne mutent
   jamais entre eux.
2. Toute transition est une transaction : verrou bien scoped → verrou offre → `UPDATE … WHERE
   statut = <attendu>` → événement.
3. Accepter une offre refuse toutes les autres `en_cours` du bien, motif `autre_offre_acceptee`,
   dans la même transaction.
4. Au plus une offre `acceptee` par bien à un instant (applicatif, sous verrou du bien) ; les
   lignes historiques incohérentes restent lisibles, jamais réparées.
5. `offres` est la seule source d'« offre en cours » dès qu'une offre canonique existe ;
   `biens.offre_en_cours_le` n'est plus écrit par le domaine Offre.
6. Présence canonique ≠ offre ouverte : jamais de retour au timestamp legacy.
7. Un événement par transition, dans la transaction, idempotent par `(type, offre_id)` /
   `(type, compromis_id)`.
8. L'annulation d'un compromis ne mute jamais l'offre.
9. Autre workspace = introuvable, pour toute lecture et toute écriture ; jamais un workspace depuis
   le formulaire.
10. Un seul writer par fait commercial : les actions legacy sont ignorées dès que l'entité
    canonique existe.
11. Aucun backfill ; aucun default qui fabrique une décision.

## Conséquences

- Le badge « Offre en cours » ne peut plus mentir ; « Offre acceptée » devient un état visible.
- Today/Automation disposera de faits Offre/Compromis fiables ; aucune règle avant
  `AUTOMATION_ENGINE_GENERALIZATION_V1`.
- Le geste « acceptation caduque » est nouveau pour le conseiller : l'UI doit le proposer au bon
  moment (après annulation de compromis, ou à la demande).
- Les listes qui affichent le statut commercial doivent le calculer en batch (aucun N+1).
- Les tests structurels « aucun UPDATE d'offres hors writer », « aucune écriture de
  `offre_en_cours_le` hors legacy-only », « événement dans la transaction » sont attendus.

## Risques

| Risque | Probabilité | Mitigation |
|---|---|---|
| Un conseiller accepte A sans réaliser que B, C seront refusées | Moyenne | confirmation explicite avec le décompte ; motif système distinct et lisible ; événements journalisés |
| Historique avec plusieurs `acceptee` par bien | Moyenne | §7 : lecture déterministe, writers refusent toute nouvelle incohérence ; index en reprise |
| Oubli du geste « caduque » après annulation de compromis → bien affiché « Offre acceptée » | Moyenne | proposition UI immédiate après annulation ; règle future « offre acceptée sans compromis depuis N jours » (automation) |
| Une page continue de lire `deriverStatutCommercial` legacy | Faible | garde structurelle : une seule règle exportée, l'ancienne supprimée ou privée |
| Interblocage bien/offre avec un writer qui verrouille dans l'autre ordre | Faible | ordre unique §15, vérifié structurellement (`FOR UPDATE` bien avant offre) |

## Hors périmètre, volontairement

Contre-offre ; conditions suspensives, apport, financement ; expiration automatique de
`date_validite` ; co-acquéreurs / `parties_offre` ; pont `acquereur_id` → Contact / projet
acquéreur ; fiche `/offres/{id}` et `/compromis/{id}` complètes (au-delà de ce que le lot exige
pour exposer les gestes) ; automatisations et Today ; clôture des tâches obsolètes ; documents liés
à l'offre ; refonte Visite ; e-signature ; provenance Offre ; index unique partiel SQL sur
`acceptee` (reprise ultérieure).

## Questions ouvertes

Aucune sur les dix-huit points. Restent ouvertes, hors périmètre : le moment où l'acquéreur des
offres devient un Contact/projet canonique ; la politique d'expiration de `date_validite` ; la
règle produit « pas d'offre sans mandat actif » (ADR-060, jamais introduite ici).

## Scalabilité

Une transaction par décision, verrou sur une ligne `biens` et quelques lignes `offres` (les offres
d'un bien se comptent en unités). Deux index FK sur `offres` posés avec leurs premiers lecteurs
scoped. Le statut commercial en liste est un agrégat par lot de biens, jamais N requêtes.

## Réversibilité

Aucune dépendance fournisseur nouvelle. Les colonnes et valeurs ajoutées sont additives ; les
timestamps legacy sont conservés intacts, donc un retour à la lecture legacy resterait possible
(au prix de l'incohérence O-3). Les événements sont des lignes Postgres ordinaires, exportables
comme le reste (ADR-051).
