# ADR-032 — Moteur d'automatisations déterministes événement → action interne

**Statut :** Accepté
**Date :** 2026-08-14
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Atlas avait déjà deux moteurs proches mais volontairement distincts : ADR-026 (alertes du
copilote — un jugement dérivé, recalculé à la lecture, jamais persisté, jamais une action) et
ADR-028 (tâches — l'action elle-même, mais toujours créée manuellement, `origine = 'automatique'`
réservé sans aucun code l'utilisant). Aucun mécanisme ne relie un fait métier survenu (une visite
marquée réalisée, un mandat signé) à la création automatique d'une tâche de suivi.

Cet ADR construit ce premier maillon : un fait métier structuré (**ÉVÉNEMENT**) déclenche
l'évaluation d'une **RÈGLE** déterministe (aucun LLM), qui produit une **EXÉCUTION** traçable,
laquelle produit au plus une **ACTION** — en V1, uniquement `creer_tache`. Ces quatre concepts
restent des tables/notions séparées, jamais fusionnées : un événement peut exister sans qu'aucune
règle n'y réagisse (règle inactive), une exécution peut échouer sans qu'aucune tâche ne soit créée,
et l'action produite (une tâche ADR-028 ordinaire, `origine = 'automatique'`) n'a aucune existence
propre en dehors de `taches`.

Un plan a été audité et validé avec sept corrections obligatoires avant codage — la décision
ci-dessous les intègre toutes.

## Décision

### 1. Idempotence de l'événement lui-même, pas seulement de l'exécution

Un `UNIQUE(regleCode, evenementId)` sur `executions_automatisation` protège seulement contre le
rejeu d'un même événement déjà enregistré. Il fallait aussi empêcher qu'un double submit de la
mutation métier (double clic, retry réseau) crée **deux événements** représentant le même fait.
Trois index uniques partiels sur `evenements_metier`, un par cible V1 :

```sql
CREATE UNIQUE INDEX "evenements_metier_visite_unique"
  ON "evenements_metier" ("type_evenement","compte_rendu_visite_id")
  WHERE "compte_rendu_visite_id" IS NOT NULL;
CREATE UNIQUE INDEX "evenements_metier_prospect_vendeur_unique"
  ON "evenements_metier" ("type_evenement","prospect_vendeur_id")
  WHERE "prospect_vendeur_id" IS NOT NULL;
CREATE UNIQUE INDEX "evenements_metier_compromis_unique"
  ON "evenements_metier" ("type_evenement","compromis_id")
  WHERE "compromis_id" IS NOT NULL;
```

`emettreEvenementEtPreparerExecutions()` insère avec `ON CONFLICT ... DO NOTHING` ciblé sur l'index
concerné — jamais un `throw` propagé : un double submit ne doit jamais faire échouer la mutation
métier qui l'accompagne, seulement ne rien dupliquer (`evenement: undefined` en retour).

Un événement n'est par ailleurs jamais émis en dehors d'une **transition métier réelle**. Pour
`rdv_estimation_realise` : seule la Server Action, avant sa transaction, compare
`rdvEstimationRealiseLe` avant/après (`undefined` → timestamp) pour décider d'émettre — le
repository lui-même n'ajoute pas de garde `IS NULL`, car re-marquer cette date reste une correction
légitime déjà possible avant cet ADR (ne jamais casser silencieusement ce cas). Pour `mandat_signe`,
`visite_realisee` et `compromis_signe`, la garde amont existante (mandat déjà signé refusé,
création de ligne = fait nouveau par construction) suffit déjà à garantir l'unicité de la
transition ; l'index partiel reste un filet de sécurité en profondeur, pas le seul mécanisme.

### 2. Aucun trou crash entre l'événement et ses exécutions prévues

Rejeté : [COMMIT mutation + événement] puis, dans un second temps, création des lignes
`executions_automatisation` à traiter. Un crash entre les deux laisserait un événement durable sans
aucune exécution jamais tentée — silencieusement perdu.

Retenu : la transaction métier fait tout d'un bloc — mutation métier, insertion de l'événement,
**et** insertion des lignes `executions_automatisation` (état implicite `a_traiter`, dérivé de
`reussieLe`/`echoueeLe` tous deux `NULL`) pour chaque règle active correspondant au type
d'événement — puis COMMIT. Le traitement effectif (construction + création de la tâche) reste
synchrone juste après, dans la même requête, jamais dans un worker (aucun n'existe, ADR-005) :

```ts
const idsExecutionsATraiter = await getDb().transaction(async (tx) => {
  const compromis = await enregistrerCompromis({ ... }, tx);
  await marquerCompromisSigne(bienId, tx);
  const { idsExecutionsATraiter } = await emettreEvenementEtPreparerExecutions(
    { typeEvenement: "compromis_signe", compromisId: compromis.id }, tx
  );
  return idsExecutionsATraiter;
});
await traiterExecutionsEnAttente(idsExecutionsATraiter); // hors transaction, après COMMIT
```

Une ligne `a_traiter` laissée après un crash (process arrêté entre le COMMIT et l'appel synchrone
qui suit) n'est **jamais perdue** — elle reste visible (page `/automatisations`, section "À
traiter") et reste traitable par un futur appel à `traiterExecutionsEnAttente()`. Aucun worker ni
retry automatique dans cette passe : le retraitement, s'il a lieu, est manuel/hors périmètre V1.

### 3. Activation figée au moment de l'événement, jamais réévaluée après coup

La décision "cette règle devait-elle réagir ?" est prise **dans la transaction métier**, au moment
exact où l'événement survient — les lignes `executions_automatisation` créées à cet instant sont ce
snapshot. Activer une règle plus tard ne traite donc jamais rétroactivement les événements déjà
survenus pendant qu'elle était inactive : aucune ligne n'a été prévue pour eux, il n'en existera
jamais. Vérifié explicitement par test (`evenementMetierRepository.test.ts`) : événement émis règle
inactive → 0 exécution ; activation ultérieure de la règle → toujours 0 exécution pour cet
événement précis.

### 4. Les quatre règles V1 démarrent inactives, seed explicite

```sql
INSERT INTO "configurations_automatisation" ("regle_code", "active") VALUES
  ('suivi_apres_visite', false),
  ('suivi_apres_rdv_estimation', false),
  ('preparation_apres_mandat', false),
  ('preparation_dossier_notaire_apres_compromis', false);
```

Aucune règle ne devient active du seul fait d'une migration/déploiement — l'activation est un geste
explicite ultérieur depuis `/automatisations`. Une ligne absente de `configurations_automatisation`
(future règle ajoutée au catalogue sans seed) est traitée comme inactive par l'appelant
(`listerConfigurationsAutomatisation()`), jamais supposée active par défaut.

### 5. `evenements_metier` append-only : aucune cascade depuis les entités source

Rejeté : `ON DELETE CASCADE` depuis `comptes_rendus_visite`/`prospects_vendeurs`/`compromis` (et
depuis `executions_automatisation.evenementId`) — supprimer une donnée métier effacerait
silencieusement la trace qu'un événement a réellement eu lieu, contraire au rôle d'audit de la
table. Retenu : aucun `onDelete` sur ces FK (`NO ACTION`, comportement par défaut Postgres/Drizzle)
— convention déjà présente une fois dans le repo (`prospectsVendeurs.bienId`). Conséquence directe
et assumée : supprimer une entité source alors qu'un événement la référence encore est **refusé**
par Postgres (violation de contrainte), jamais un `DELETE` silencieux en cascade. `taches` reste en
`ON DELETE CASCADE` classique (ADR-028) — seule la trace d'audit `evenements_metier` est protégée,
pas l'action produite. `executionsAutomatisation.tacheId` reste `ON DELETE SET NULL` : supprimer la
tâche produite ne doit jamais empêcher de supprimer son exécution (le lien devient simplement
absent).

### 6. Création de la tâche et succès de l'exécution : une seule transaction

Rejeté : créer la tâche, puis mettre à jour l'exécution séparément — un crash entre les deux
laisserait une tâche orpheline de son audit (aucune ligne `executions_automatisation` ne la
référence jamais). Retenu (`moteur.ts`, `traiterUneExecution`) :

```ts
await getDb().transaction(async (tx) => {
  const execution = await verrouillerExecutionATraiter(executionId, tx); // SELECT ... FOR UPDATE
  if (!execution) return;                                                // déjà résolue, rien à faire
  const champs = await regle.construireTache(evenement);
  if (!champs) { await marquerExecutionReussie(executionId, undefined, tx); return; }
  const tache = await creerTache({ ...champs, origine: "automatique", origineCode: regle.code }, tx);
  await marquerExecutionReussie(executionId, tache.id, tx);
});
```

Si cette transaction échoue (`construireTache`/`creerTache` lève), Postgres l'annule dans son
ensemble — **aucune tâche n'est jamais créée orpheline**. L'échec est enregistré séparément, hors de
cette transaction déjà avortée (`marquerExecutionEchouee`, écriture indépendante, gel concurrent par
les mêmes gardes `IS NULL`) : `echoueeLe` + un message technique court (`erreur.message.slice(0,
200)`, jamais un dump brut). `verrouillerExecutionATraiter` (`SELECT ... FOR UPDATE WHERE
reussieLe IS NULL AND echoueeLe IS NULL`) rend un second traitement de la même ligne déjà résolue un
no-op — jamais une seconde tâche pour la même exécution.

### 7. Page `/automatisations` — visibilité complète, aucun état invisible

En plus de la dernière exécution par règle, trois états doivent rester visibles à tout moment : **À
traiter**, **Réussie**, **Échouée** (`deriverEtatExecutionAutomatisation`, dérivé de
`reussieLe`/`echoueeLe`, jamais stocké) — un crash après la transaction métier ne doit jamais
transformer une exécution en problème invisible. Aucun retry automatique proposé dans cette page.

**Décisions déjà validées en amont du codage** : `ajouterCompromisAction` devient transactionnel
(corrige une non-atomicité préexistante entre enregistrement du compromis et pose de
`compromisSigneLe`, en même temps qu'elle y accroche l'émission de l'événement) ; table
`evenements_metier` persistée ; règles écrites en TypeScript (catalogue versionné et testé),
activation seule en base ; seule action automatique V1 = `creer_tache` — `envoyer_email`,
`envoyer_sms`, `transmettre_pack_notaire`, `modifier_offre`, `modifier_compromis`, `archiver`,
`supprimer` restent explicitement hors périmètre ; aucune échéance artificielle sur les tâches
produites ; aucune règle fondée sur la checklist ADR-029 (aucun événement structuré n'existe encore
pour un constat documentaire) ; aucun scheduler ; aucun LLM ; provenance visible sur la tâche
produite ; une tâche annulée ou terminée n'est jamais recréée pour la même occurrence (l'exécution
déjà `reussie` ne retraite jamais).

## Séparation des quatre concepts

| Concept | Table | Rôle |
|---|---|---|
| ÉVÉNEMENT | `evenements_metier` | Fait métier structuré déjà survenu, append-only |
| RÈGLE | `catalogueRegles.ts` (code, pas une table) | Association type d'événement → construction de tâche, déterministe |
| EXÉCUTION | `executions_automatisation` | Une tentative d'application d'une règle à un événement, traçable |
| ACTION PRODUITE | `taches` (ADR-028) | La tâche elle-même, `origine = 'automatique'` |

## Catalogue des 4 règles V1

| Code | Événement déclencheur | Cible de la tâche produite |
|---|---|---|
| `suivi_apres_visite` | `visite_realisee` | `{ type: "visite", id: compteRenduVisiteId }` |
| `suivi_apres_rdv_estimation` | `rdv_estimation_realise` | `{ type: "prospectVendeur", id: prospectVendeurId }` |
| `preparation_apres_mandat` | `mandat_signe` | `{ type: "bien", id: prospect.bienId }` (lecture seule via `getProspectVendeurById`) |
| `preparation_dossier_notaire_apres_compromis` | `compromis_signe` | `{ type: "compromis", id: compromisId }` |

Chaque règle expose `construireTache(evenement): Promise<ChampsTacheAutomatique | undefined>` —
`undefined` signifie explicitement "cette règle décide de ne rien produire pour ce cas précis"
(aucune des 4 règles V1 n'emprunte cette branche aujourd'hui, mais l'exécution est tout de même
marquée `reussie`, sans `tacheId` : un résultat honnête, pas un échec).

## Contrat de types

```ts
export type TypeEvenementMetier =
  "visite_realisee" | "rdv_estimation_realise" | "mandat_signe" | "compromis_signe";

export type CodeRegleAutomatisation =
  "suivi_apres_visite" | "suivi_apres_rdv_estimation" | "preparation_apres_mandat"
  | "preparation_dossier_notaire_apres_compromis";

export type EtatExecutionAutomatisation = "a_traiter" | "reussie" | "echouee"; // dérivé, jamais stocké

// Type de retour monomorphe de construireTache() — AUCUN champ "actionType" générique. Étendre le
// moteur à une autre catégorie d'action nécessiterait de changer ce type lui-même, jamais d'ajouter
// un cas dans un switch : c'est la frontière de sécurité qui empêche un simple actionType =
// "envoyer_email" de contourner le périmètre V1.
export type ChampsTacheAutomatique = {
  titre: string; contexte?: string; type: TypeTache; priorite: PrioriteTache; cible: CibleTache;
};
```

## Conséquences

- Migration `0020_furry_whirlwind.sql` : tables `evenements_metier` (3 FK nullables `NO ACTION`,
  `CHECK` une seule cible renseignée, 3 index uniques partiels), `executions_automatisation`
  (`UNIQUE(regleCode, evenementId)`, `tacheId` `ON DELETE SET NULL`), `configurations_automatisation`
  (`regleCode` PK, seed des 4 règles `active = false`).
- Nouveaux fichiers : `src/types/automatisation.ts`,
  `src/lib/automatisations/{catalogueRegles,evenementMetierRepository,
  configurationAutomatisationRepository,executionAutomatisationRepository,moteur}.ts`,
  `src/actions/automatisations.ts`, `src/app/automatisations/page.tsx`.
- Fichiers modifiés en profondeur : `src/lib/tacheRepository.ts`
  (`creerTache(input, executeur)`), `src/lib/compteRenduVisiteRepository.ts`,
  `src/lib/compromisRepository.ts`, `src/lib/bienRepository.ts` (`marquerCompromisSigne`) — tous
  étendus d'un paramètre `executeur: Executeur` optionnel pour composer avec la transaction
  d'émission d'événement ; `src/lib/prospectVendeurRepository.ts`
  (`marquerRdvEstimationRealiseProspectVendeur`, `signerMandatProspectVendeur`) ;
  `src/actions/{enregistrerCompteRenduVisite,prospectVendeur,compromis}.ts` (les 4 points de
  déclenchement, dont la correction transactionnelle d'`ajouterCompromisAction`) ;
  `src/components/aujourd-hui/TacheItem.tsx`, `src/app/prospects-vendeurs/[id]/page.tsx`,
  `src/components/bien/BienTabs.tsx` + `src/app/biens/[id]/page.tsx` (provenance "Créée
  automatiquement — Règle : {nom}" sur une tâche `origine = 'automatique'` — `BienTabs.tsx` est
  `"use client"` et ne peut pas importer `catalogueRegles.ts` (transitivement server-only via
  `prospectVendeurRepository.ts`) : `LABEL_REGLE_AUTOMATISATION` lui est passé en prop depuis la
  page serveur) ; `src/components/layout/NavItems.tsx` (entrée "Automatisations").
- Tests : `evenementMetierRepository.test.ts` (idempotence de l'événement par type, activation
  figée au moment de l'événement, contrainte `UNIQUE` de l'exécution), `moteur.test.ts` (atomicité
  tâche+succès, scénario crash/pending, échec de `creerTache` → aucune tâche + `echouee` — simulé
  par mock ciblé de `creerTache`, seul point qu'aucune donnée métier légitime ne peut faire échouer
  organiquement grâce à la correction n°5, double-submit bout en bout pour chacune des 4 règles).
  Effet de bord découvert en cours de validation : plusieurs suites préexistantes
  (`actions/compromis.test.ts`, `actions/prospectVendeur.test.ts`,
  `lib/prospectVendeurRepository.test.ts`,
  `lib/documents/coherenceRattachementDocument.test.ts`,
  `lib/communications/destinataireCommunication.test.ts`) signent un mandat ou créent un compromis
  dans leur fixture puis suppriment l'entité en `afterAll` — désormais bloqué par la correction n°5
  (`NO ACTION`) tant que l'événement associé n'est pas purgé en premier. Corrigé dans ces 5 fichiers
  (purge de `executions_automatisation`/`evenements_metier` référençant l'entité, avant sa
  suppression) plutôt qu'en affaiblissant la contrainte — la garantie d'audit prime sur le confort
  de nettoyage des tests. Suite complète (84 fichiers, 647 tests) passante ; build de production
  passant, route `/automatisations` générée.
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- **Hors périmètre V1, réservé à des passes ultérieures** : toute action externe à conséquence
  (email, SMS, transmission notaire, modification d'offre/compromis, archivage, suppression) ;
  scheduler/échéances artificielles (ex. "aucun contact depuis 7 jours") ; règles fondées sur un
  constat de checklist documentaire (ADR-029) — aucun événement structuré équivalent n'existe
  encore ; retry automatique d'une exécution `echouee` ou d'une exécution `a_traiter` laissée par un
  crash ; constructeur de règles no-code ; modification/annulation d'une exécution déjà résolue.
