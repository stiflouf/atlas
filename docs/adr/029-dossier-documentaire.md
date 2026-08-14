# ADR-029 — Dossier documentaire transactionnel

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Audit complet du système documentaire réel (`documents_bien`, ADR-013) et des entités
bien/acquéreur/prospect vendeur/offre/compromis/tâches (ADR-014 à ADR-028) avant tout codage.
`documents_bien` ne rattachait un document qu'à un bien (`bienId`, FK réelle) ; aucune notion de
personne, de compromis, de copropriété, de date du document, de validité, ni d'état de
vérification n'existait. Le mock parallèle (`data/dossier.ts`, `DocumentDossier`) était encore
plus pauvre (type texte libre).

Retours terrain d'une clerc de notaire, pris comme besoin produit **non exhaustif et non
juridiquement validé**, jamais transformé silencieusement en obligation légale codée : agents
mélangeant des pièces entre dossiers, documents reçus pour la mauvaise copropriété, absence
d'indication sur la charge des honoraires d'agence dans les compromis, pièces d'identité mal
rattachées, diagnostics présents mais potentiellement périmés.

Un tour de revue architecturale a validé la direction de l'audit avec cinq corrections
obligatoires avant codage, intégrées ci-dessous. Codage direct après incorporation, sans nouveau
tour de plan.

## Décision

### 1. Quatre concepts séparés

DOCUMENT (fichier reçu), RATTACHEMENT (bien/personne/transaction/copropriété), EXIGENCE
DOCUMENTAIRE (règle produit codée) et CONTRÔLE (état dérivé, jamais stocké comme collection de
booléens). Aucune de ces séparations n'introduit de nouvelle table dédiée par concept — DOCUMENT
et RATTACHEMENT restent portés par `documents_bien` étendue ; EXIGENCE et CONTRÔLE vivent
entièrement en code (`src/lib/documents/checklistDossier.ts`).

### 2. Immutabilité du fichier séparée de la correction du classement (correction obligatoire n° 1)

Le fichier physique reste strictement append-only (ADR-013 inchangée) :
`nomFichierOriginal`/`cleStockage`/`tailleOctets`/`typeMime`/`creeLe` ne sont jamais modifiés après
création. Toutes les autres colonnes (`bienId` inclus — un document peut être réattribué à un
autre bien, cas réel le plus fréquent du retour terrain) sont des métadonnées de classement,
corrigibles via `corrigerClassementDocumentBien` (`documentBienRepository.ts`) :
**remplacement complet** des champs corrigibles à chaque appel, jamais un patch partiel — même
contrat que `modifierRemunerationPrevisionnelle` (ADR-021, `number | null`/`string | null`
explicites pour distinguer "vider" de "ne pas toucher"). `modifieLe` (nullable, posé uniquement
par une correction) suit le même patron que `remuneration.modifieLe`. Une erreur de classement ne
devient jamais irréversible sans pour autant introduire de versionnement/historique des
corrections (non demandé).

### 3. Invariants de cohérence entre rattachements (correction obligatoire n° 2)

Des FK valides séparément ne suffisent pas. `src/lib/documents/coherenceRattachementDocument.ts`
(`validerCoherenceRattachementsDocument`, appelée par les Server Actions, jamais par le
repository) vérifie :
- si `compromisId` est renseigné, `compromis.bienId === bienId` du document ;
- si `compromisId` et `acquereurId` sont renseignés ensemble, `compromis.acquereurId ===
  acquereurId` ;
- si `prospectVendeurId` est renseigné, `prospectVendeur.bienId === bienId` du document (le
  prospect doit être celui ayant réellement converti ce bien, ADR-027).

Ces comparaisons inter-tables ne sont pas exprimables en `CHECK` SQL — même séparation que les
règles de cohérence offre/compromis (ADR-016). `compromisId`/`acquereurId`/`prospectVendeurId`
sont trois FK **nullables et cumulables** (jamais le patron "au plus une cible" de `taches`,
ADR-028) : un document peut légitimement porter `bienId` et `acquereurId` en même temps. Toutes
trois en `ON DELETE SET NULL` (comme `compromis.offreId`, ADR-016) — un document reste consultable
même si la cible d'un rattachement disparaissait.

### 4. Deux vocabulaires d'état distincts, jamais confondus (correction obligatoire n° 3)

`documentsBien.etatVerification` (`non_verifie` / `confirme` / `a_verifier` / `rejete`, colonne,
défaut `non_verifie`) porte un jugement du conseiller sur le **classement** d'un document précis.
L'état de contrôle d'une **exigence** de checklist (`present` / `manquant` / `a_verifier` /
`non_applicable` / `perime` / `incoherent`) est entièrement **dérivé** à la lecture
(`calculerChecklistDossier`), jamais stocké. `manquant`, `perime` et `incoherent` ne sont jamais
posés sur un document : `incoherent` se déduit uniquement d'un `etatVerification = 'rejete'`
explicitement signalé par le conseiller (jamais une déduction automatique — aucun OCR, aucun LLM
dans cette passe) ; `perime` se déduit d'une `dateFinValidite` dépassée sur une exigence à suivi de
validité (diagnostics) ; `a_verifier` se déduit soit d'une validité inconnue, soit d'un
`etatVerification = 'a_verifier'` porté par le document trouvé.

### 5. Charge des honoraires portée par `biens`, pas `compromis` (correction obligatoire n° 4)

Ré-audit explicite demandé avant migration. `biens.chargeHonoraires` (nouvelle colonne, `CHECK IN
('vendeur','acquereur')`) plutôt que `compromis.chargeHonoraires` : Atlas ne modélise pas de
mandat comme entité séparée — `biens` porte déjà les conditions du mandat (`prix`, `statutMandat`,
`dateMandat`) — et la charge des honoraires est une condition commerciale connue **avant** toute
offre ou tout compromis, pas seulement au moment de la rédaction du compromis (l'usage terrain
cité par la clerc situe le problème au compromis, mais la donnée existe en amont). La porter sur
`biens` permet à Atlas de signaler l'absence dès la commercialisation et évite toute
ressaisie/duplication entre bien et compromis.

**V1 volontairement binaire** (`vendeur` | `acquereur`) : le vocabulaire aurait pu inclure
`partagee`, mais aucune répartition réelle (montants/pourcentages par partie) n'est demandée
aujourd'hui — l'ajouter sans modéliser la répartition aurait été un état à moitié construit.
Distinct et jamais confondu avec `remuneration.montantRemunerationConseillerCentimes` (ADR-021,
part du conseiller) : l'un est qualitatif (qui doit les honoraires de la transaction), l'autre
financier (combien perçoit le conseiller) — deux faits différents.

### 6. Vocabulaire `typeDocument` fermé mais non exhaustif juridiquement (correction obligatoire n° 5)

`TYPES_DOCUMENT` (`src/types/documentBien.ts`, 28 valeurs) donne une orthographe stable à un type
de pièce donné, réparties en huit familles (`FamilleDocument` : parties/bien/diagnostics/
copropriete/transaction/financement/notaire/autre) via `FAMILLE_PAR_TYPE_DOCUMENT`. `autre` +
`typeDocumentDetail` (texte libre) couvrent tout ce qui n'y figure pas encore, même patron que
`origineLead`/`origineLeadDetail` (ADR-027). Ce vocabulaire est **produit**, jamais une affirmation
d'exhaustivité juridique — repris explicitement du retour terrain, à auditer officiellement avant
toute transformation en obligation.

`FamilleDocument` est **décorrélée** de `categorie` (colonne existante, ADR-013, 7 valeurs
`mandat`/`diagnostic`/`copropriete`/`technique`/`commercial`/`compromis`/`autre`) : les deux
vocabulaires ne se recouvrent pas terme à terme et les unifier aurait exigé de migrer les valeurs
déjà en base — hors périmètre. `categorie` reste inchangée, toujours choisie librement à l'ajout.

### 7. PV d'assemblée générale : jamais un booléen

Chaque PV est un document (`typeDocument = 'pv_ag'`) avec `dateDocument` = date de l'AG. "3
derniers PV, 2 présents" est calculé à la lecture (`calculerChecklistDossier`, champ `pvAg`) —
tri décroissant sur `dateDocument` (repli sur `creeLe`), jamais un compteur stocké. Un document
`pv_ag` avec `etatVerification = 'rejete'` n'est jamais compté comme présent.

### 8. Diagnostics : présence ≠ validité

`dateFinValidite` (nouvelle colonne, nullable) est **purement déclarative** — aucune durée légale
n'est calculée depuis la mémoire de l'assistant. Sans elle, l'exigence correspondante reste
`a_verifier`, jamais présumée valide. Un futur référentiel des durées légales par type de
diagnostic devra suivre le même patron que `regle_fiscale` (ADR-023 : source officielle datée,
`statutVerification`) — non construit ici.

### 9. Pas de nouvelle entité `dossier_vente`, pas d'entité `copropriete` dédiée

Le "dossier de vente" est une **vue composée**, dérivée à la lecture de `bien` + le compromis
pertinent (`en_cours`, sinon le plus récent) + le prospect vendeur d'origine (`getProspectVendeurParBien`)
+ les documents rattachés (`/biens/[id]`, `calculerChecklistDossier`) — aucune table
supplémentaire pour lui donner une existence propre, conformément au principe "pas d'entité
uniquement pour un joli nom d'UI".

Aucune entité `copropriete` dédiée : `biens.nomCopropriete` (texte déclaratif, nouvelle colonne)
et `documentsBien.coproprieteDeclaree`/`adresseDeclaree` (texte déclaratif) suffisent à préparer
une comparaison **humaine** future (anti-mauvais-dossier), sans intégrité relationnelle
supplémentaire. Une vraie table `copropriete` reste une évolution propre si un besoin de
mutualisation entre plusieurs biens d'une même résidence apparaît un jour — pas avant.

### 10. Moteur de checklist déterministe et pur

`calculerChecklistDossier(contexte, documents, maintenant?)` (`src/lib/documents/
checklistDossier.ts`) : contexte (`bien`, `compromisActuel?`, `prospectVendeurOrigine?`) + règles
codées (`REGLES_CHECKLIST`, un noyau minimal par famille, pas une couverture exhaustive) +
documents présents ⇒ un `ResultatExigence` par règle (`code`, `famille`, `label`, `etat`,
`document?`), jamais un score global. Chaque exigence est `applicable` selon le contexte (ex. le
bloc copropriété n'est applicable que si `bien.nomCopropriete` est renseigné) puis `correspond` à
un sous-ensemble de documents ; le document retenu est le plus récent (`dateDocument`, repli
`creeLe`) parmi les non-rejetés. Résultat séparé `honorairesRenseignes` (dérivé de
`biens.chargeHonoraires`, pas un document) et `pvAg` (voir point 7).

### 11. Anti-mauvais-dossier : préparation seulement

`documentsBien.coproprieteDeclaree`/`adresseDeclaree` sont le seul terrain préparé pour une future
comparaison automatisée avec `biens.nomCopropriete`/`biens.adresse`. Aucune extraction, aucun
rattachement probabiliste dans cette passe — un futur ADR pourra introduire un état de
rattachement à trois valeurs (`propose`/`confirme`/`rejete`) sur le lien document↔cible, non
implémenté ici.

### 12. Constats, pas de tâches (ADR-028)

ADR-029 produit uniquement des constats documentaires dérivés, affichés dans le bloc "Dossier
documentaire" de l'onglet Documents — aucune tâche générée automatiquement, aucun dual-write avec
`taches`. La chaîne constat → règle d'automatisation → tâche `origine = 'automatique'` (déjà
préparée côté ADR-028 via `origineCode`) reste un futur ADR.

## Alternatives écartées

- **`objetType`/`objetId` polymorphe pour les rattachements documentaires** : même rejet que pour
  `taches` (ADR-028) — sacrifierait l'intégrité référentielle native de Postgres.
- **Une entité `dossier_vente`** : aucune identité métier propre au-delà de ce que `bien` +
  `compromis` + parties liées expriment déjà — une vue composée suffit.
- **Une entité `copropriete` dès cette passe** : aucun besoin de mutualisation/intégrité réel
  exprimé aujourd'hui ; un champ texte déclaratif est la solution minimale évolutive.
- **`chargeHonoraires` sur `compromis`** : aurait dupliqué/décalé une information de mandat déjà
  connue avant tout compromis, et créé un risque de divergence entre bien et compromis.
- **Vocabulaire `partagee` pour `chargeHonoraires`** : état à moitié construit sans modélisation de
  répartition réelle — écarté pour la V1.
- **Une table de règles de checklist en base** (comme `regle_fiscale`) : les règles de checklist
  n'ont pas le même besoin de traçabilité de source légale datée que le référentiel fiscal — code
  TypeScript testable, pas de table, tant que ce besoin n'est pas exprimé.
- **Historique/versionnement des corrections de classement** : non demandé — la valeur courante
  fait foi, `modifieLe` suffit (même choix que `remuneration`, ADR-021).

## Conséquences

- Migration `0018_wise_morgan_stark.sql` : `biens.nomCopropriete`/`biens.chargeHonoraires` ;
  `documentsBien.typeDocument`/`typeDocumentDetail`/`dateDocument`/`dateFinValidite`/`compromisId`/
  `acquereurId`/`prospectVendeurId`/`coproprieteDeclaree`/`adresseDeclaree`/`provenance`/
  `etatVerification`/`modifieLe` — toutes colonnes nullables ou à défaut explicite, aucun backfill.
- Nouveaux fichiers : `src/lib/documents/checklistDossier.ts`,
  `src/lib/documents/coherenceRattachementDocument.ts`.
- `src/types/documentBien.ts` : `FamilleDocument`, `TypeDocument`, `TYPES_DOCUMENT`,
  `FAMILLE_PAR_TYPE_DOCUMENT`, `EtatVerificationDocument`, `ChampsCorrectionDocumentBien`.
- `src/types/bien.ts` : `ChargeHonoraires`.
- `src/lib/documentBienRepository.ts` : `corrigerClassementDocumentBien`.
- `src/lib/prospectVendeurRepository.ts` : `getProspectVendeurParBien` (nouveau lookup par
  `bienId`, nécessaire pour dériver le contexte du dossier).
- `src/actions/ajouterDocumentBien.ts` : `ajouterDocumentBienAction` passe du refus silencieux au
  refus explicite (`throw`), cohérent avec le reste du domaine (offres/compromis/rémunération,
  ADR-015/016/021) ; nouvelle `corrigerClassementDocumentBienAction`.
- `src/components/bien/BienTabs.tsx` : bloc "Dossier documentaire" (checklist par famille, PV AG,
  signal honoraires) en tête de l'onglet Documents ; formulaire d'ajout étendu ; correction de
  classement par document (`<details>`).
- `src/app/biens/[id]/page.tsx` : calcule `compromisActuel`/`prospectVendeurOrigine`/`checklist` et
  les transmet à `BienTabs`.
- Tests : `checklistDossier.test.ts` (16 cas), `coherenceRattachementDocument.test.ts` (6 cas
  d'intégration Postgres), `documentBienRepository.test.ts` étendu (correction, immutabilité du
  fichier), `ajouterDocumentBien.test.ts` étendu (refus explicite, cohérence, correction),
  `bienFormulaire.test.ts` étendu — suite complète du projet passante (540 tests).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- **Hors périmètre, réservé à des passes ultérieures** : entité `copropriete`, CRM personne
  universel, support multi-acquéreurs/indivision vendeur, OCR/LLM/rattachement probabiliste,
  durées légales de validité des diagnostics, génération automatique de tâches/emails de relance,
  suppression/édition du fichier physique, table `encaissements`, table de règles de checklist en
  base, historique des corrections de classement, sélecteur de bien (remplacement du champ texte
  libre pour corriger `bienId`).
