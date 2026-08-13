# ADR-028 — Moteur de tâches générique

**Statut :** Accepté
**Date :** 2026-08-13
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

`actions` (table introduite très tôt, `0002_cultured_masked_marvel.sql`) était le seul moteur de
tâches d'Atlas : `bienId`/`acquereurId` en `text` sans FK (ADR-010, pensé pour un référentiel
encore partiellement mocké), `statut` stocké (`a_faire`/`termine`), aucun lien vers un prospect
vendeur (inexistant avant ADR-027), aucune notion d'annulation. ADR-027 a explicitement réservé le
rattachement propre des tâches/relances aux différents objets métier (bien, acquéreur, prospect
vendeur) à un futur ADR-028 dédié plutôt que d'improviser une solution partielle dans son propre
périmètre.

Un premier plan a été discuté et validé avec quatre corrections obligatoires avant codage — la
décision ci-dessous les intègre toutes.

## Décision

### 1. Sept FK nullables dédiées, jamais `objetType`/`objetId` polymorphe

Rejeté explicitement : un couple générique `objetType: string` + `objetId: uuid` sans FK réelle.
Bien que plus "extensible" en apparence, il sacrifie l'intégrité référentielle que Postgres peut
garantir nativement — une valeur `objetId` orpheline serait indétectable par le schéma lui-même,
seulement par une discipline applicative.

Retenu : sept colonnes FK nullables dédiées, une par cible réellement supportée aujourd'hui —
`bienId`, `acquereurId`, `prospectVendeurId`, `visiteId`, `offreId`, `compromisId`,
`remunerationId`, chacune `ON DELETE CASCADE` vers sa table. Une contrainte `CHECK`
(`taches_une_seule_cible_check`) garantit qu'au plus une est renseignée à la fois (somme des sept
indicatrices de présence `<= 1`) :

```sql
CONSTRAINT "taches_une_seule_cible_check" CHECK ((
  (CASE WHEN "bien_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "acquereur_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "prospect_vendeur_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "visite_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "offre_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "compromis_id" IS NOT NULL THEN 1 ELSE 0 END) +
  (CASE WHEN "remuneration_id" IS NOT NULL THEN 1 ELSE 0 END)
) <= 1)
```

Une tâche sans aucune cible reste explicitement autorisée (tâche générale) — la contrainte est
`<= 1`, jamais `= 1`. Au-dessus de ces sept colonnes, une union TypeScript générique reste exposée
pour ne pas obliger chaque appelant à connaître les sept noms de colonnes :

```ts
export type TypeCible =
  | "bien" | "acquereur" | "prospectVendeur" | "visite" | "offre" | "compromis" | "remuneration";
export type CibleTache = { type: TypeCible; id: string };

// Vue dérivée des sept colonnes — jamais une donnée stockée séparément.
export function deriverCibleTache(tache: Tache): CibleTache | undefined { /* ... */ }
```

`creerTache()` (`tacheRepository.ts`) accepte `cible?: CibleTache` et traduit vers la seule colonne
concernée à l'insertion — la forme générique n'existe qu'en entrée/sortie d'API, jamais en base.

Les mocks (`data/taches.ts`) restent, comme tout mock Atlas, hors DB par construction (ids
non-UUID) — leur existence ne justifie jamais d'affaiblir l'intégrité référentielle des tâches
réelles.

### 2. Aucune colonne d'interaction sur `taches` — l'interaction reste un fait distinct (ADR-027)

Rejeté : des colonnes `interactionType`/`interactionContenu` sur `taches`, qui auraient permis de
capturer accessoirement une interaction au moment de terminer une tâche de contact. Une tâche
("il faut appeler M. Dupont") et une interaction ("j'ai appelé M. Dupont, voici ce qu'il a dit")
sont deux faits différents dans le temps ; les confondre dans une même ligne aurait empêché de
représenter une tâche terminée sans interaction réelle (ex. tâche annulée, ou terminée par erreur)
et inversement.

`taches` ne porte donc **aucune** colonne d'interaction. Pour le seul domaine qui a déjà un journal
d'interactions structuré (prospect vendeur, `notes_prospect_vendeur` + `dernierContactLe`,
ADR-027), `terminerTacheAction` (`actions/terminerTache.ts`) permet d'enregistrer, **dans le même
geste mais via une case à cocher explicite et distincte**, une vraie interaction :

```ts
export async function terminerTacheAction(formData: FormData): Promise<void> {
  const tache = await getTacheById(id);
  await terminerTache(id);

  const enregistrerInteraction = formData.get("enregistrerInteraction") === "on";
  if (enregistrerInteraction && tache?.prospectVendeurId) {
    // ... valide type/contenu, appelle ajouterNoteProspectVendeur() (ADR-027)
  }
  redirect(redirectTo);
}
```

Deux écritures séquentielles, pas une transaction partagée : un échec de la seconde (rare) laisse
la tâche terminée avec l'interaction non journalisée — état mineur et récupérable, pas comparable à
un bien orphelin. Terminer une tâche **ne signifie jamais** silencieusement "contact réalisé" :
sans la case cochée, aucune interaction n'est enregistrée, y compris pour une tâche de type
`appel`/`relance`. Aucun mécanisme équivalent n'existe pour les autres cibles (bien, acquéreur,
visite, offre, compromis, rémunération) — elles n'ont pas encore de journal d'interactions
structuré ; une future timeline CRM traitera ce sujet proprement, pas cet ADR.

### 3. "Sans échéance" en UI, jamais "En attente" — `en_attente` réservé

`StatutTache` conserve quatre valeurs : `a_faire`, `terminee`, `annulee`, `en_attente`. Les trois
premières sont dérivées à la lecture (`deriverStatutTache`, ci-dessous) ; la quatrième n'est
**jamais dérivée aujourd'hui** — elle est réservée pour une future vraie notion métier d'attente
(attente d'un retour client, d'un notaire, d'un document), qui nécessitera sa propre colonne/logique
quand elle sera construite. Une tâche ouverte sans échéance reste `a_faire`. Le libellé d'affichage
pour une échéance manquante est `LABEL_ECHEANCE_ABSENTE = "Sans échéance"` — jamais "En attente",
qui aurait laissé croire à l'existence de cette notion avant qu'elle ne soit réellement construite.

### 4. Migration sans heuristique

**Audit préalable, pas de choix arbitraire.** Avant toute migration des lignes `actions`, un audit
explicite a vérifié le nombre de lignes portant simultanément `bien_id` et `acquereur_id` non NULL
(un cas impossible à traduire sans arbitrage vers les nouvelles FK mutuellement exclusives) :
**zéro ligne trouvée** en local — la migration a donc pu procéder normalement. Le principe reste
documenté pour toute ré-exécution ailleurs : au moins une ligne aurait dû arrêter la migration pour
un traitement explicite (jamais un choix arbitraire de laquelle des deux cibles garder).

**`prospectsVendeurs.prochaineAction`/`prochaineActionLe` migrés puis supprimés dans la même
migration** — jamais de dual-write permanent : chaque ligne non NULL de `prochaine_action` est
convertie en une tâche réelle (`prospectVendeurId` renseigné, `origine = 'manuelle'`), puis les deux
anciennes colonnes sont `DROP`. Migration `0017_sudden_surge.sql` :

```sql
CREATE TABLE "taches" ( /* ... */ );
ALTER TABLE "taches" ADD CONSTRAINT /* 7 FK + CHECK */;

-- Migration actions -> taches (aucune ligne bien_id + acquereur_id simultanés, audit préalable)
INSERT INTO taches (id, titre, contexte, type, priorite, echeance, origine,
                     bien_id, acquereur_id, cree_le, terminee_le)
SELECT gen_random_uuid(), titre, contexte, type, priorite, echeance, 'manuelle',
       CASE WHEN bien_id ~ '^[0-9a-f]{8}-...' THEN bien_id::uuid ELSE NULL END,
       CASE WHEN acquereur_id ~ '^[0-9a-f]{8}-...' THEN acquereur_id::uuid ELSE NULL END,
       cree_le, termine_le
FROM actions;

-- Migration prospectsVendeurs.prochaineAction/prochaineActionLe -> taches
INSERT INTO taches (id, titre, echeance, prospect_vendeur_id, type, priorite, origine)
SELECT gen_random_uuid(), prochaine_action, prochaine_action_le, id, 'autre', 'normale', 'manuelle'
FROM prospects_vendeurs WHERE prochaine_action IS NOT NULL;

DROP TABLE actions CASCADE;
ALTER TABLE prospects_vendeurs DROP COLUMN prochaine_action;
ALTER TABLE prospects_vendeurs DROP COLUMN prochaine_action_le;
```

Les ids texte `bien_id`/`acquereur_id` d'`actions` (ADR-010, sans garantie de format UUID) sont
transformés via un `CASE` regex-gardé plutôt qu'un cast direct — une ligne mockée résiduelle
(format non-UUID) migre alors vers une tâche sans cible plutôt que de faire échouer la migration
entière.

**Décisions finales validées** : renommer `actions` → `taches` (oui) ; migrer
`prochaineAction`/`prochaineActionLe` immédiatement (oui) ; aucune période de compatibilité ;
aucune règle automatique de relance construite dans cette passe. Renommer `origineDetail` (nom
provisoire du plan initial) en **`origineCode`** : un identifiant machine stable destiné aux
futures règles automatiques pour retrouver/dédupliquer leurs propres tâches — jamais du texte
d'affichage (ce rôle reste `contexte`).

## Contrat de types

```ts
export type StatutTache = "a_faire" | "terminee" | "annulee" | "en_attente"; // en_attente réservé
export type PrioriteTache = "haute" | "normale" | "basse";
export type TypeTache = "appel" | "email" | "message" | "document" | "relance" | "autre";
export type OrigineTache = "manuelle" | "automatique"; // 'automatique' réservé, aucun code actuel

export type Tache = {
  id: string; titre: string; contexte?: string; type: TypeTache; priorite: PrioriteTache;
  echeance?: string; origine: OrigineTache; origineCode?: string;
  bienId?: string; acquereurId?: string; prospectVendeurId?: string; visiteId?: string;
  offreId?: string; compromisId?: string; remunerationId?: string;
  creeLe: string; termineeLe?: string; annuleeLe?: string;
};

// Dérivé de termineeLe/annuleeLe, jamais stocké — même principe que deriverStatutCommercial
// (ADR-014) / deriverStatutProspectVendeur (ADR-027).
function deriverStatutTache(tache: Tache): StatutTache {
  if (tache.annuleeLe) return "annulee";
  if (tache.termineeLe) return "terminee";
  return "a_faire";
}
```

`terminerTache()`/`annulerTache()` (`tacheRepository.ts`) réutilisent le patron "gel concurrent"
déjà établi (`marquerCompromisRealise`/`marquerRemunerationEncaissee`, ADR-016/021) :
`UPDATE ... WHERE id = ? AND terminee_le IS NULL AND annulee_le IS NULL RETURNING *` — un second
appel concurrent ne touche aucune ligne, le repository retourne `undefined` plutôt que d'écraser
silencieusement une transition déjà actée. `terminee_le` et `annulee_le` sont donc mutuellement
exclusives par construction applicative, jamais une contrainte SQL supplémentaire.

## Priorité (`tachePriority.ts`)

Refonte directe de l'ancien `actionPriority.ts`, même moteur déterministe (score = poids de
priorité + bonus retard/imminence, tri stable par `creeLe`), avec une différence de fond : une
tâche `terminee` **ou** `annulee` est désormais exclue des listes actives (`scoreTache = -Infinity`
dans les deux cas), alors que l'ancien code n'excluait que `termine` (`annule` n'existait pas).

## UX

- **`/taches/nouveau`** — formulaire de création avec sélection de cible à trois `<select>`
  (bien/acquéreur/prospect vendeur), pré-remplissage par query param
  (`?bienId=`/`?acquereurId=`/`?prospectVendeurId=`) depuis les fiches, jamais plus d'une cible
  soumise (miroir applicatif du `CHECK`).
- Section **Tâches** sur les fiches bien, acquéreur et prospect vendeur, et sur l'accueil
  ("Dossiers nécessitant une action" pour les tâches liées à un bien, "Autres tâches" pour le
  reste) — un seul moteur de tri (`tachePriority.ts`), jamais réimplémenté par page.
- Terminer une tâche liée à un prospect vendeur affiche, en plus de la case "Terminer", un formulaire
  optionnel replié (`<details>`) pour enregistrer une vraie interaction dans le même geste.

## Conséquences

- Migration `0017_sudden_surge.sql` : table `taches` (7 FK + `CHECK` une seule cible), suppression
  de `actions` (`DROP TABLE ... CASCADE`), suppression de
  `prospectsVendeurs.prochaineAction`/`prochaineActionLe`, migration des données des deux dans le
  même fichier.
- Nouveaux fichiers : `src/types/tache.ts`, `src/data/taches.ts`, `src/lib/tacheRepository.ts`,
  `src/lib/tachePriority.ts`, `src/actions/{creerTache,terminerTache,annulerTache}.ts`,
  `src/app/taches/nouveau/page.tsx`, `src/components/aujourd-hui/TacheItem.tsx`.
- Fichiers supprimés : `src/types/action.ts`, `src/lib/actionRepository.ts`,
  `src/lib/actionPriority.ts`, `src/data/actions.ts`, `src/actions/{creerAction,terminerAction}.ts`,
  `src/app/actions/`, `src/components/aujourd-hui/ActionItem.tsx`.
- Fichiers modifiés en profondeur : `src/lib/historiqueBien.ts` (paramètre `Tache[]`, textes "Tâche
  créée/terminée/annulée"), `src/lib/memoireDossier.ts` (renommage du concept local de provenance
  bien/acquéreur en `provenance`, distinct de `Tache.origine`), `src/components/bien/BienTabs.tsx`,
  toutes les pages de fiche, `src/app/page.tsx`, `src/app/visites/[id]/preparer/page.tsx`,
  `src/lib/prospectVendeurRepository.ts`/`prospectVendeurFormulaire.ts`/
  `ProspectVendeurFormulaire.tsx` (suppression des deux anciens champs simples).
- Tests : `tacheRepository.test.ts` (intégration Postgres — CHECK, gel concurrent, cibles),
  `tachePriority.test.ts`, `creerTache.test.ts`/`terminerTache.test.ts`/`annulerTache.test.ts`
  (garde-fous archivage, interaction opt-in), `historiqueBien.test.ts`/`memoireDossier.test.ts`/
  `BienTabs.test.tsx` mis à jour ; suite complète du projet passante (508 tests ADR-028 inclus, 4
  échecs préexistants et sans rapport dans `src/lib/fiscal/` — données de seed local, non modifiées
  par cette passe).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`/`docs/FLOWS.md`/`docs/DEMO_VS_REAL.md`/
  `docs/ARCHITECTURE.md` mis à jour en conséquence.
- **Documenté mais non implémenté** : une future passe d'automatisation (génération de tâches
  `origine = 'automatique'`, ex. relances après N jours de silence) devra explicitement gérer
  l'idempotence/déduplication de ses propres tâches générées (ne pas recréer une relance déjà
  ouverte pour la même cause) — `origineCode` est le champ prévu pour cela, aucun mécanisme de
  vérification n'existe encore. Non construit ici puisqu'aucune règle automatique n'existe.
- Hors périmètre, réservé à des passes ultérieures : génération automatique de tâches, notion
  métier réelle d'attente (`en_attente`), édition/suppression d'une tâche existante, timeline CRM
  unifiée des interactions tous domaines confondus, récurrence.
