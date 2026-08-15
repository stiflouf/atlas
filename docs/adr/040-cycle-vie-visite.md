# ADR-040 — Cycle de vie d'une visite : entité métier minimale `visites`

**Statut :** Accepté
**Date :** 2026-08-15
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Un audit préalable en lecture seule a établi un fait fondamental, jusqu'ici jamais formulé aussi
explicitement : **Atlas ne possédait aucune entité métier `visites`.** Ce qu'un conseiller appelle
« une visite » recouvrait deux objets disjoints, jamais reliés par un identifiant commun :

1. **Avant** — un événement Google Calendar (ou mock `data/agenda.ts`), type `RendezVous`,
   éphémère, jamais persisté comme fait métier.
2. **Après** — une ligne `comptes_rendus_visite`, créée uniquement si le conseiller remplissait le
   formulaire de `/visites/[id]/preparer` (où `[id]` était l'id du rendez-vous Calendar, jamais un
   id de visite Atlas).

Cette absence expliquait une limite déjà documentée dans ADR-037 : la règle
`nouveau_match_bien_acquereur` ne pouvait pas vérifier « une visite est-elle déjà programmée pour
cette paire ? », faute de signal persisté et interrogeable — seules les offres/compromis en cours
étaient vérifiés. Elle expliquait aussi une dette déjà connue (`docs/KNOWN_LIMITATIONS.md`) :
l'onglet « Visites → À venir » de la fiche bien lisait exclusivement un mock statique, jamais rien
de réel pour un bien réel.

## Décision

### 1. Nouvelle table `visites` — entité minimale, distincte de tout le reste

```sql
CREATE TABLE "visites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "bien_id" uuid NOT NULL REFERENCES biens(id) ON DELETE CASCADE,
  "acquereur_id" uuid NOT NULL REFERENCES acquereurs(id) ON DELETE CASCADE,
  "date_prevue" date NOT NULL,
  "statut" text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee','realisee','annulee')),
  "rendez_vous_calendar_id" text NOT NULL UNIQUE,
  "cree_le" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "comptes_rendus_visite" ADD COLUMN "visite_id" uuid REFERENCES visites(id) ON DELETE SET NULL;
```

Une visite représente « une rencontre immobilière planifiée entre UN Bien et UN Acquéreur, suivie
par Atlas » — cardinalité imposée par deux colonnes scalaires `NOT NULL`, jamais une convention UI
seule. `date_prevue` est un simple `date` (jour civil), jamais un `timestamptz` : même convention
que `comptes_rendus_visite.date_visite`/`offres.date_offre`/`compromis.date_signature`, toutes des
dates civiles d'un fait commercial. `rendez_vous_calendar_id` est une simple référence vers la
source externe (id `RendezVous` — `"gcal-xxxx"` ou un id mock), **jamais la PK métier** : la Visite
possède son propre `id`. `UNIQUE` dessus, garantie DB (pas seulement applicative) qu'un même
rendez-vous Calendar ne matérialise jamais deux visites.

**`comptes_rendus_visite` reste une table séparée, jamais fusionnée** (ADR-011 toujours valide,
append-only). En particulier, `interet` (déjà `interesse`/`a_reflechir`/`pas_interesse`/`inconnu`)
n'est jamais dupliqué sur `visites` : `visites.statut` répond à « que s'est-il passé avec la
visite ? », `comptesRendusVisite.interet` répond à « quel est le retour commercial de
l'acquéreur ? ». Une visite peut parfaitement être `realisee` + `interet: pas_interesse` sans que
ces deux notions ne se mélangent jamais dans un seul champ.

### 2. Trois statuts V1, aucun `en_cours`

```
planifiee ──→ realisee
          └──→ annulee
```

Aucune logique basée sur l'heure courante ne modifie automatiquement le statut — invariant absolu :
`date_prevue < maintenant` ne signifie **jamais** `realisee`. Une visite passée encore `planifiee`
reste explicitement une visite dont Atlas ne connaît pas l'issue (testé explicitement,
`visiteRepository.test.ts`). Aucun `en_cours` : une visite immobilière dure 20-40 minutes, aucun
besoin d'état temps réel persisté observé dans l'usage actuel.

Gardes atomiques (même patron que `terminerTache`/`marquerOffreEnCours`) : chaque transition est un
`UPDATE ... WHERE statut = 'planifiee'` — 0 ligne affectée (`undefined` retourné) plutôt qu'une
écrasement silencieux depuis un état déjà terminal. `realisee` n'est jamais réouvrable ;
`annulee` n'est jamais réalisable a posteriori.

### 3. Matérialisation explicite, jamais un import silencieux de Calendar

Une ligne `visites` naît **uniquement** au moment où le conseiller atteint
`/visites/[id]/preparer` pour un rendez-vous dont le bien **et** l'acquéreur sont résolus sans
ambiguïté (le garde-fou déjà existant de cette page — `!contexte.bien || !contexte.client` →
message d'échec, jamais de préparation affichée). C'est ce geste explicite qui fait entrer un
rendez-vous Calendar dans Atlas comme une vraie visite, **jamais** un scan automatique de tout le
calendrier. Aucune ligne `visites` n'est jamais créée pour un résultat de matching ambigu ou non
confirmé.

```ts
// src/lib/visiteRepository.ts — matérialisation idempotente au niveau DB
await visitesTable.insert(...).onConflictDoNothing({ target: visitesTable.rendezVousCalendarId });
// si rien inséré (conflit réel) : relecture par rendez_vous_calendar_id
```

Idempotent **au niveau DB** (`UNIQUE`), pas seulement un find-before-insert applicatif : deux
appels réellement concurrents pour le même rendez-vous (double clic, double onglet) ne créent
jamais deux lignes — testé explicitement avec deux appels concurrents.

**Aucun fallback mock** : la matérialisation n'a lieu que si le bien **et** l'acquéreur résolus
sont de vrais UUID persistés (`UUID_REGEX.test(...)`). Dans le cas contraire (base entièrement
vide, tout repose encore sur les mocks), aucune visite n'est créée et la page continue de
fonctionner exactement comme avant ADR-040 — comportement déjà existant, jamais régressé.

### 4. Aucune création native indépendante de Calendar

Confirmé par l'audit : aucun parcours existant ne permet de créer une visite dans Atlas sans passer
par un rendez-vous Calendar. ADR-040 ne construit donc pas de formulaire « Nouvelle visite »
indépendant. **Limite assumée et documentée** (`docs/KNOWN_LIMITATIONS.md`) : la création native
n'est pas le parcours V1.

### 5. Report — même visite, jamais annulée + recréée

```ts
modifierDatePrevueVisite(id, nouvelleDatePrevue) // WHERE statut = 'planifiee'
```

Un report modifie `date_prevue` sur la même ligne, même `id` — jamais un statut `reportee` dédié
(l'information est déjà portée par la nouvelle date), jamais une seconde ligne créée. Restreint aux
visites encore `planifiee` : reporter une visite déjà tranchée n'a pas de sens métier.

### 6. Annulation — sans taxonomie de motif

```ts
annulerVisite(id) // WHERE statut = 'planifiee'
```

Aucun champ `motif`, aucune raison obligatoire, aucun workflow supplémentaire — si le conseiller
veut documenter le contexte, la note libre déjà existante (`notes_bien`) suffit, jamais interprétée
par Atlas.

### 7. Compte rendu → transition `realisee`, une seule transaction

`enregistrerCompteRenduVisiteAction` reçoit désormais un `visiteId` (hidden field, dérivé de la
matérialisation faite au chargement de la page de préparation — jamais un id soumis à l'aveugle : la
Server Action revalide `visite.bienId === bienId && visite.acquereurId === acquereurId &&
visite.statut === "planifiee"` avant toute transition).

```ts
BEGIN
  compteRendu = enregistrerCompteRenduVisite({ ..., visiteId }, tx)
  si visiteValide : marquerVisiteRealisee(visiteValide.id, tx)   // WHERE statut = 'planifiee'
  emettreEvenementEtPreparerExecutions({ typeEvenement: "visite_realisee", compteRenduVisiteId }, tx)
COMMIT
traiterExecutionsEnAttente(...)  // hors transaction, même patron ADR-032
```

Une visite déjà tranchée (`realisee`/`annulee`) n'affiche plus le formulaire de compte rendu — un
message neutre le remplace (« Cette visite a déjà été marquée « … » »), même patron que le garde
d'archivage bien/acquéreur déjà présent sur cette page. `visiteId` reste **optionnel** : si la
visite n'a pas pu être matérialisée (cas mock, §3), le compte rendu s'enregistre exactement comme
avant ADR-040, sans transition associée — aucune régression du chemin existant.

### 8. `visite_realisee` et `suivi_apres_visite` — réutilisés tels quels

L'événement `visite_realisee` existait déjà en production (émis à chaque compte rendu depuis
ADR-032) — **aucun second type créé**. Son émission n'est pas modifiée dans sa forme (toujours
`compteRenduVisiteId` comme provenance) : ADR-040 ajoute simplement une transition de statut
supplémentaire dans la même transaction, sans toucher au contrat de l'événement lui-même. La règle
`suivi_apres_visite` (désactivée par défaut, ADR-032) continue de se déclencher sur ce même
événement sans aucune modification — non-régression testée explicitement.

### 9. `nouveau_match_bien_acquereur` (ADR-037) — la limite documentée est levée

```ts
// src/lib/automatisations/catalogueRegles.ts
const visitePlanifiee = await existeVisitePlanifieePourPaire(bienId, acquereurId);
if (visitePlanifiee) return undefined;
```

Ajouté au même niveau que les gardes offre/compromis déjà en place — une visite `planifiee` pour la
paire précise rend le contact redondant. Une visite `realisee` ou `annulee` **ne bloque jamais**
indéfiniment un futur cycle légitime (seul `planifiee` compte, jamais une simple existence
historique) — comportement exact demandé, testé explicitement pour les trois statuts et pour une
visite planifiée sur un *autre* bien du même acquéreur (ne doit pas bloquer cette paire précise).
ADR-040 ne supprime jamais automatiquement une tâche déjà ouverte lorsqu'une visite est ensuite
planifiée — sujet distinct, hors périmètre ici.

### 10. Fiche bien — onglet « À venir » désormais réel

`BienTabs.tsx` lit désormais `visites` (statut `planifiee`, triées par date) pour tout bien réel —
remplace le mock statique `rendezVousDuJour` qui n'affichait jamais rien de vrai pour un bien réel
(limite déjà documentée, désormais levée). Le mock reste inchangé pour un bien mocké (`dossier`
présent) : aucune régression de ce chemin, jamais de visite persistée pour une entité fictive.

### 11. Identité URL stable `/visites/{id}` — redirection, jamais une seconde interface

```
GET /visites/{visiteAtlasId} → redirect(/visites/{rendezVousCalendarId}/preparer)
```

Nouvelle route minimale : ne duplique pas la préparation riche déjà existante (transports, écoles,
patrimoine, marché…), se contente de résoudre l'id Atlas vers l'id Calendar déjà stocké et de
rediriger. `/visites/[id]/preparer` (id Calendar) continue de fonctionner exactement comme avant —
aucune URL existante cassée.

**Limitation assumée et documentée** : rien ne pointe encore vers `/visites/{id}` aujourd'hui. La
tâche `suivi_apres_visite` cible toujours `comptes_rendus_visite.id` (`taches.visite_id`,
inchangé), jamais un `visites.id` — `deriverRouteFicheCible()` (ADR-039) n'a donc **pas** été
étendue pour le type de cible `"visite"` dans cette ADR : traiter un id de compte rendu comme une
PK Visite serait exactement l'erreur que cette ADR met en garde d'éviter. Faire pointer cette règle
vers la Visite plutôt que le compte rendu est un changement de modèle distinct, volontairement hors
périmètre ici (voir « Hors périmètre »).

### 12. Historique — aucune migration de données passées

Aucune ligne `visites` n'existait avant ADR-040 : il n'y a donc littéralement aucune visite
historique à statuer rétroactivement. Les `comptes_rendus_visite` déjà présents restent avec
`visite_id = NULL` — **aucun backfill par proximité de date, aucune heuristique** : le lien n'existe
que pour les comptes rendus créés après cette ADR, via une vraie visite matérialisée. L'historique
reste lisible exactement comme avant (`historiqueBien.ts` inchangé).

## Hors périmètre, volontairement

Agenda Atlas complet, synchronisation Calendar bidirectionnelle temps réel (webhook, watch Google,
polling), email/SMS automatique, IA de compte rendu, transcription, scoring acquéreur, motifs
d'annulation structurés, statuts `en_cours`/`reportee`, import automatique de tous les événements
Calendar, suppression automatique d'une tâche nouveau match déjà ouverte, migration de
`suivi_apres_visite` vers une cible `visites` plutôt que `comptes_rendus_visite`.

## Conséquences

- Migration `0026_flowery_mephisto.sql` : nouvelle table `visites`, colonne
  `comptes_rendus_visite.visite_id` (nullable). Aucune ligne existante à migrer.
- Nouveaux fichiers : `src/types/visite.ts`, `src/lib/visiteRepository.ts`,
  `src/actions/visite.ts`, `src/app/visites/[id]/page.tsx`.
- Fichiers modifiés : `src/db/schema.ts`, `src/types/compteRenduVisite.ts`,
  `src/lib/compteRenduVisiteRepository.ts`, `src/actions/enregistrerCompteRenduVisite.ts`,
  `src/app/visites/[id]/preparer/page.tsx`, `src/app/biens/[id]/page.tsx`,
  `src/components/bien/BienTabs.tsx`, `src/lib/automatisations/catalogueRegles.ts`.
- Tests : `src/lib/visiteRepository.test.ts` (14 cas), extension de
  `src/actions/enregistrerCompteRenduVisite.test.ts` (+4 cas) et de
  `src/lib/automatisations/catalogueRegles.nouveauMatch.test.ts` (+4 cas).
- `docs/DATA_MODEL.md`/`docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/
  `docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md` mis à jour en conséquence.
- Hors périmètre, réservé à une ADR ultérieure : câblage de `deriverRouteFicheCible()` pour la
  cible `visite` (nécessiterait de faire cibler `visites.id` plutôt que
  `comptes_rendus_visite.id` par `suivi_apres_visite` — décision de modèle distincte), création
  native d'une visite indépendante de Calendar, nettoyage automatique des tâches nouveau match
  devenues redondantes.
