# ADR-038 — Reprise durable des exécutions d'automatisation bloquées

**Statut :** Accepté
**Date :** 2026-08-15
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

ADR-036/037 ont chacune signalé, en l'auditant sans le corriger, une dette réelle : une
`execution_automatisation` restée `a_traiter` après une interruption du process (crash, redémarrage)
n'a aucun filet de reprise générique — contrairement aux transitions de compatibilité (ADR-036,
`/api/compatibilite/scan`) ou au scanner temporel (ADR-033, `/api/automatisations/scan`).

Un audit préalable de `moteur.ts` (`traiterUneExecution`) a établi, sur le code réel, une propriété
décisive : la création de la tâche et la pose de `reussieLe` vivent **déjà** dans la même
transaction Postgres (`tx`), un invariant documenté depuis ADR-032 elle-même ("correction n°6") —
*"le tout dans UNE SEULE transaction... AUCUNE tâche n'est jamais créée orpheline de son audit"*.
Un crash ne peut donc jamais laisser une tâche persistée sans que l'exécution correspondante soit
marquée `reussie` : soit la transaction commit intégralement, soit rien n'existe. Cette ADR construit
donc un mécanisme de reprise volontairement simple, qui **s'appuie sur cette atomicité déjà acquise**
plutôt que d'en réinventer une, en la préservant explicitement.

## Décision

### 1. Aucun nouvel état, aucune lease

`a_traiter` (aucun des deux timestamps terminaux posé) reste le seul signal d'une exécution à
reprendre — indiscernable entre "jamais commencée" et "tentée puis avortée par un crash", et sans
besoin de les distinguer : dans les deux cas, rien de durable n'existe encore, la reprise consiste
toujours à rejouer depuis zéro. Aucun statut `en_cours`, aucun jeton de claim/lease : ils
n'apporteraient aucune garantie supplémentaire pour un effet strictement transactionnel DB.

### 2. Deux colonnes ajoutées, aucun nouveau statut

```sql
ALTER TABLE executions_automatisation
  ADD COLUMN nombre_tentatives integer NOT NULL DEFAULT 0,
  ADD COLUMN derniere_tentative_le timestamptz;
ALTER TABLE executions_automatisation
  ADD CONSTRAINT executions_automatisation_nombre_tentatives_positif_check CHECK (nombre_tentatives >= 0);
```

Purement observationnelles et de contrôle de plafond — **jamais** la source de la garantie
d'idempotence, qui reste entièrement portée par `UNIQUE(regle_code, evenement_id)` et la transaction
unique effet+`reussieLe` de `traiterUneExecution`. L'incrément vit dans sa **propre petite
transaction, séparée** de celle du traitement (`incrementerTentativeExecution`,
`executionAutomatisationRepository.ts`) : posée **avant** toute tentative risquée, pour rester
durable même si cette tentative crashe à nouveau — sinon le compteur sous-estimerait une boucle de
crash répétée, son seul rôle utile.

### 3. Plafond de tentatives — constante de code

```ts
export const MAX_TENTATIVES_AUTOMATISATION = 5; // src/lib/automatisations/reprise.ts
```

Même statut que `SEUIL_FIABLE` (ADR-035) : un paramètre technique, pas un réglage produit. Une
exécution dont l'incrément dépasse ce plafond devient **terminale via la sémantique d'échec déjà
existante** (`echoueeLe`, message *"Nombre maximal de tentatives de reprise atteint"*) — jamais un
troisième statut inventé, jamais un retry éternel silencieux.

### 4. `echoueeLe` reste terminal, jamais retenté automatiquement

Décision assumée : Atlas ne possède aujourd'hui aucune classification fiable d'erreur transitoire
vs permanente (`categoriserErreur()` ne lit aucun code SQLSTATE) — automatiser un retry sur
`echouee` risquerait une boucle silencieuse sur une erreur réellement permanente. Seules les lignes
`a_traiter` sont reprises ; un retry manuel éventuel des échecs reste un chantier séparé, hors
périmètre ici.

### 5. `undefined` reste un succès, jamais repris

Contrat ADR-032/037 inchangé : `construireTache() → undefined` pose `reussieLe` sans tâche — un
résultat honnête ("aucun effet nécessaire"), jamais une erreur. Sort donc immédiatement de la
sélection `WHERE reussieLe IS NULL AND echoueeLe IS NULL`, jamais retraité par un scan suivant.

### 6. Réutilisation stricte du noyau existant

```ts
// src/lib/automatisations/reprise.ts
reprendreExecutionsBloquees(limite = 200):
  candidates = listerExecutionsATraiter(limite)   // WHERE reussieLe IS NULL AND echoueeLe IS NULL
  pour chaque candidate :
    tentative = incrementerTentativeExecution(id)  // transaction séparée, avant tout risque
    si absente (déjà résolue entre-temps) → ignorée
    si tentative.nombreTentatives > MAX_TENTATIVES_AUTOMATISATION → marquerExecutionEchouee(...)
    sinon → traiterExecutionsEnAttente([id])        // noyau canonique INCHANGÉ (moteur.ts)
```

**Aucune seconde implémentation des règles métier.** `traiterExecutionsEnAttente`/
`traiterUneExecution` (`moteur.ts`) ne sont ni modifiées ni dupliquées — la reprise n'est qu'un
découvreur de candidates, réutilisant tel quel le chemin déjà atomique.

### 7. Concurrence — verrou existant, sans ajout

`verrouillerExecutionATraiter` (`SELECT ... FOR UPDATE`, déjà en place depuis ADR-032) suffit :
deux appels de reprise concurrents sur la même ligne se sérialisent sur ce verrou ; celui qui se
débloque après le commit de l'autre relit une ligne déjà résolue (`WHERE reussieLe IS NULL...` ne
matche plus) et ne fait rien. Aucun `SKIP LOCKED` retenu (optimisation de débit non nécessaire au
volume V1, non un besoin de correction). Testé explicitement avec deux appels réellement
concurrents.

### 8. Endpoint dédié, jamais mélangé au scan temporel

`POST /api/automatisations/reprise`, secret **dédié** `AUTOMATISATIONS_REPRISE_SECRET` (distinct
d'`AUTOMATISATIONS_SCAN_SECRET`) — même raisonnement qu'ADR-036 pour deux endpoints distincts :
responsabilités différentes (rejouer des exécutions bloquées ≠ exécuter/évaluer le scanner
temporel ADR-033), un secret compromis pour l'un ne doit jamais ouvrir l'autre. Même patron exact
que les trois endpoints précédents : `POST` uniquement, `Authorization: Bearer`, comparaison
`timingSafeEqual`, 503 si secret absent, 401 sinon, aucune PII dans la réponse ni les logs
(`executionId`/`regleCode`/`evenementId`/erreur déjà tronquée uniquement).

### 9. Activation figée — confirmée, jamais contournée

`reprendreExecutionsBloquees()` ne touche jamais `evenements_metier` ni
`configurations_automatisation` : elle travaille exclusivement sur des `executions_automatisation`
déjà créées et déjà légitimes. Testé explicitement : un événement survenu pendant que la règle est
inactive ne produit toujours aucune exécution, et la reprise n'en crée aucune non plus — elle ne
fait que découvrir et rejouer ce qui existe déjà.

### 10. Effets DB uniquement — hypothèse vérifiée et documentée

Recherche exhaustive confirmée : aucune des 6 règles actuelles (`suivi_apres_visite`,
`suivi_apres_rdv_estimation`, `preparation_apres_mandat`,
`preparation_dossier_notaire_apres_compromis`, `inactivite_prospect_vendeur`,
`nouveau_match_bien_acquereur`) n'appelle Gmail, Calendar ou une API externe. Cette stratégie de
reprise est correcte **parce que** les effets actuels sont strictement transactionnels PostgreSQL —
documenté explicitement (`KNOWN_LIMITATIONS.md`, `AI_HANDOFF.md`) : avant d'ajouter un effet
externe non transactionnel à une règle, réévaluer l'idempotence/reprise ADR-038, une transaction
Postgres ne pouvant jamais rendre atomique un appel externe.

## Hors périmètre, volontairement

Retry automatique des exécutions `echouee`, bouton UI de relance manuelle, statut `en_cours`/lease,
worker distribué, queue externe (Redis/SQS/Kafka), infrastructure disproportionnée — PostgreSQL
seul reste suffisant en V1, confirmé par l'analyse d'atomicité, pas supposé par principe.

## Conséquences

- Migration `0025_wide_mindworm.sql` : `nombre_tentatives`/`derniere_tentative_le` sur
  `executions_automatisation`, `CHECK` associé. Aucune ligne existante à retraiter (0 exécution
  bloquée constatée en développement au moment de l'audit).
- Nouveaux fichiers : `src/lib/automatisations/reprise.ts`,
  `src/app/api/automatisations/reprise/route.ts`.
- Fichiers modifiés : `src/db/schema.ts`, `src/types/automatisation.ts`, `src/lib/automatisations/
  executionAutomatisationRepository.ts` (`listerExecutionsATraiter`,
  `incrementerTentativeExecution`) — `moteur.ts` **non modifié**.
- Tests : `src/lib/automatisations/reprise.test.ts` (8 cas), `src/app/api/automatisations/reprise/
  route.test.ts` (5 cas) — sélection, plafond, idempotence/concurrence réelle, `undefined` et
  erreur technique toujours terminaux, activation figée jamais contournée.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à une ADR ultérieure : mécanisme de reprise pour un effet externe non
  transactionnel, retry différencié transitoire/permanent des `echouee`, outil de relance manuelle.
