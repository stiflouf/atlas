# ADR-039 — Cockpit commercial quotidien / « À faire aujourd'hui »

**Statut :** Accepté
**Date :** 2026-08-15
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le besoin exprimé au départ — donner au conseiller un cockpit quotidien centralisant alertes,
agenda et tâches prioritaires — a fait l'objet d'un audit préalable en lecture seule sur le code
réel de `src/app/page.tsx` (composant `AujourdHui`, route `/`).

**Correction de prémisse, actée comme décision d'architecture :** cet audit a établi qu'Atlas
possède déjà ce cockpit. La page `/` (déjà intitulée « Aujourd'hui » dans `NavItems.tsx`) affiche
déjà : les alertes prioritaires (ADR-026), l'agenda du jour et à venir (Google Calendar ou source
démo), les « Dossiers nécessitant une action » (une tâche prioritaire par bien, dérivée
déterministiquement), et « Autres tâches » (tâches sans bien rattaché, rendues via `TacheItem`) —
avec exclusion déjà correcte des biens/acquéreurs/prospects vendeurs archivés, et un tri
déterministe déjà en place (`tachePriority.ts`, `scoreTache`/`trierParPriorite`, jamais un score
affiché comme tel, jamais de LLM).

ADR-039 ne construit donc **pas** un nouveau tableau de bord ni une nouvelle route : c'est un
raffinement ciblé et testé du cockpit `/` existant, qui comblait trois manques réels identifiés par
l'audit — aucune navigation directe vers la fiche d'une tâche, une fonction `estEnRetard()` déjà
écrite mais jamais utilisée par l'UI, et une absence totale de couverture de test pour `page.tsx`
lui-même.

## Décision

### 1. Une seule route, aucune duplication

`/` reste l'unique cockpit. Aucune route `/aujourdhui`, `/taches` ou `/cockpit` n'est créée.
Structure existante préservée telle quelle : en-tête, alertes, agenda, « Dossiers nécessitant une
action », « Autres tâches ». Aucun graphique, KPI, score affiché ou classement par IA.

### 2. « Voir la fiche » — dérivée, jamais une nouvelle requête

```ts
// src/types/tache.ts
const ROUTE_FICHE_PAR_TYPE_CIBLE: Partial<Record<TypeCible, string>> = {
  bien: "/biens",
  acquereur: "/clients",
  prospectVendeur: "/prospects-vendeurs",
};

export function deriverRouteFicheCible(tache: Tache): string | undefined {
  const cible = deriverCibleTache(tache);
  if (!cible) return undefined;
  const prefixe = ROUTE_FICHE_PAR_TYPE_CIBLE[cible.type];
  return prefixe ? `${prefixe}/${cible.id}` : undefined;
}
```

Fonction pure, dérivée de `deriverCibleTache()` (ADR-028, déjà existante) — aucune requête
supplémentaire, aucun résolveur parallèle, aucun parsing de titre. Seuls les trois types de cible
possédant une fiche navigable réelle (bien, acquéreur, prospect vendeur) produisent un lien ; visite/
offre/compromis/rémunération n'ont aucune page dédiée aujourd'hui (consultables uniquement depuis la
fiche bien qui les héberge) et ne reçoivent donc jamais de lien construit à l'aveugle. Une tâche sans
cible exploitable n'affiche simplement pas l'action.

### 3. Nouveau match (ADR-037) — cible acquéreur, jamais de lien Bien reconstruit

La tâche `nouveau_match_bien_acquereur` ne cible structurellement que l'acquéreur (ADR-028/037,
`taches_une_seule_cible_check`). « Voir la fiche » y résout donc vers la fiche acquéreur. Aucun
parsing du titre pour en extraire une référence de bien, aucune re-consultation de l'événement
ADR-036 à l'origine, aucune seconde cible ajoutée à `taches`, aucun mécanisme spécifique à cette
règle : le comportement est celui, générique, du point 2. « Préparer un email » (ADR-031-bis) reste
inchangé et continue de résoudre le même acquéreur — additif, jamais remplacé par le nouveau lien.

### 4. Badge « En retard » — réutilise `estEnRetard()`, ne la redéfinit pas

```tsx
{estEnRetard(tache) && <Badge variant="danger">En retard</Badge>}
```

`estEnRetard()` (`src/lib/tachePriority.ts`) existait déjà mais n'était utilisée par aucune UI avant
cette ADR. Aucune seconde définition du retard : le badge affiche un fait déjà déterminé par la
fonction existante. Une tâche sans échéance n'est structurellement jamais en retard.

### 5. État vide — scopé, jamais un remplacement de section active

```tsx
{dossiersAttention.length === 0 && autresTaches.length === 0 && (
  <p className="text-[13px] text-[#94a3b8]">Rien à traiter pour le moment.</p>
)}
```

Message neutre affiché uniquement quand les deux sections de tâches sont simultanément vides —
n'apparaît jamais si l'agenda ou les alertes ont par ailleurs du contenu, et ne masque jamais ces
sections.

### 6. `TacheItem` reste l'unique composant

Aucun second composant (type `CockpitTaskItem`) créé : `TacheItem` (`src/components/aujourd-hui/
TacheItem.tsx`) est étendu minimalement (lien « Voir la fiche », badge « En retard »), garantissant
un comportement cohérent partout où il est déjà rendu (cockpit, fiches bien/acquéreur/prospect
vendeur). Provenance automatique/manuelle (ADR-032) et « Préparer un email » restent inchangés dans
leur logique.

### 7. Aucune migration

Aucun changement de schéma : `deriverRouteFicheCible()` est une fonction pure sur des colonnes déjà
existantes, `estEnRetard()` déjà écrite, l'état vide une condition sur des tableaux déjà calculés.

### 8. Tests — `TacheItem` étendu et première couverture réelle de `/`

`src/components/aujourd-hui/TacheItem.test.tsx` (13 cas, nouveau fichier) : lien « Voir la fiche »
par type de cible (bien/acquéreur/prospect vendeur), absence de lien pour les quatre types sans
fiche et pour une tâche sans cible, non-régression du nouveau match (lien acquéreur, « Préparer un
email » toujours présent, jamais de lien `/biens/`), badge « En retard » (échéance dépassée/future/
absente), provenance automatique/manuelle inchangée.

`src/app/page.test.tsx` (7 cas, nouveau fichier — `page.tsx` n'avait auparavant aucun test) :
intégration réelle sur Postgres (aucun mock du repository), tâche manuelle visible, tâche
automatique nouveau match visible avec provenance et lien acquéreur, tâche terminée absente, tâche
liée à un bien affichée sans duplication dans « Dossiers nécessitant une action », bien archivé
retirant sa tâche sans lien cassé, tâche sans cible exploitable sans lien factice, état vide vérifié
de façon adaptative (assertion conditionnée au compte réel de tâches actives en base au moment du
test, jamais un compte global figé — la base de développement étant partagée avec le reste de la
suite). Chaque assertion de présence est scopée au titre unique créé par le test concerné.

**Point technique découvert pendant l'écriture des tests :** `renderToStaticMarkup` (utilisée pour
`TacheItem` seul) ne supporte pas un composant serveur asynchrone imbriqué non résolu — `AgendaCard`
(`export default async function`) apparaît dans l'arbre de `page.tsx` et fait lever « A component
suspended while responding to synchronous input » sous `renderToStaticMarkup`. `page.test.tsx`
utilise donc `renderToPipeableStream` (même API de rendu que Next.js, capable d'attendre les
composants serveur asynchrones), bufferisé en chaîne via `onAllReady`.

## Hors périmètre, volontairement

Nouvelle route/tableau de bord, nouvelle table, moteur de priorité alternatif, statistiques
commerciales, graphiques, score affiché, priorisation ou résumé par IA, lien Bien reconstruit pour
le nouveau match, parsing de titre, double cible sur une tâche, historique des tâches sur `/`,
refonte responsive générale, nouvelle règle d'automatisation.

## Conséquences

- Aucune migration.
- Fichiers modifiés : `src/types/tache.ts` (`deriverRouteFicheCible`), `src/components/aujourd-hui/
  TacheItem.tsx` (lien « Voir la fiche », badge « En retard »), `src/app/page.tsx` (état vide
  scopé).
- Nouveaux fichiers de test : `src/components/aujourd-hui/TacheItem.test.tsx` (13 cas),
  `src/app/page.test.tsx` (7 cas, première couverture de la page).
- `docs/BUSINESS_RULES.md`/`docs/KNOWN_LIMITATIONS.md`/`docs/CHANGELOG_V1.md`/`docs/AI_HANDOFF.md`
  mis à jour en conséquence. `docs/DATA_MODEL.md` **non modifié** — aucun changement de modèle.
- Limite documentée : la tâche `nouveau_match_bien_acquereur` ne cible que l'acquéreur ; le bien
  associé n'est pas une seconde cible structurée de la tâche, et n'apparaît donc pas comme un lien
  « Voir la fiche » dédié.
