# Mode démo vs données réelles — Atlas (`apps/web`)

Ce document explique précisément quand Atlas utilise des données mockées, quand il bascule sur
PostgreSQL, et pourquoi les deux ne sont **jamais** mélangés. Comportement vérifié directement
dans `src/lib/bienRepository.ts`, `clientRepository.ts`, `actionRepository.ts`,
`noteBienRepository.ts`, `compteRenduVisiteRepository.ts`, `google/agendaSource.ts`.

## Le principe : bascule stricte, jamais de fusion

Pour chaque catalogue qui a un équivalent mock (biens, acquéreurs, actions), la règle est
identique :

> S'il existe **au moins une** ligne réelle dans la table Postgres correspondante, la fonction de
> lecture retourne **uniquement** les lignes réelles. Les données mockées ne sont jamais ajoutées
> en complément, même partiellement.

```ts
// Patron exact, répété dans bienRepository.ts / clientRepository.ts / actionRepository.ts.
// Pour biens/acquereurs, un second axe orthogonal s'ajoute depuis ADR-012 : la bascule démo/réel
// (length > 0, TOUTES lignes confondues) est indépendante du filtre actif/archivé appliqué au
// résultat retourné — voir "Archivage" plus bas.
export async function listerBiens(): Promise<Bien[]> {
  try {
    const lignes = await getDb().select().from(biensTable);
    if (lignes.length > 0) return lignes.filter((l) => !l.archiveLe).map(ligneVersBien);
  } catch (erreur) {
    console.error("[biens] lecture Postgres indisponible, repli sur les mocks :", erreur);
  }
  return biensDemo;
}
```

**Pourquoi jamais de mélange** : le moteur de matching (`construireContexte`) compare le titre/
lieu d'un rendez-vous à *tout* le référentiel de biens/acquéreurs disponible. Mélanger un bien réel
"123 rue de la Paix" et un bien mocké "Appartement Oberkampf" au même moment créerait un risque de
faux rapprochement (le mock n'a pas vocation à exister en même temps qu'une donnée réelle
équivalente) et rendrait le comportement de l'app imprévisible selon l'ordre d'insertion. Une
bascule nette, catalogue par catalogue, est plus prévisible qu'une fusion partielle.

## La bascule est indépendante par catalogue

Il n'existe **pas** un seul "mode démo global". Chaque catalogue a son propre état, déterminé
uniquement par le contenu de sa propre table :

| Catalogue | Fonction de lecture | Bascule réelle dès que... |
|---|---|---|
| Biens | `listerBiens()` / `getBienById()` | ≥ 1 ligne dans `biens` |
| Acquéreurs | `listerClients()` / `getClientById()` | ≥ 1 ligne dans `acquereurs` |
| Actions | `listerActions()` | ≥ 1 ligne dans `actions` |
| Agenda (Google Calendar) | `getAgendaSemaine()` | Une connexion existe dans `connexions_google` **et** l'appel à l'API Google réussit (axe totalement indépendant des trois précédents) |

Il est donc parfaitement normal, en cours de développement ou de démonstration, d'avoir des biens
réels alors que les acquéreurs sont encore mockés, ou l'inverse.

**`notes_bien` et `comptes_rendus_visite` n'ont aucun équivalent mock** : ce sont des
fonctionnalités qui n'existent que pour un bien réel (voir plus bas, "fonctionnalités encore
mock-only" pour le pendant symétrique). Il n'y a donc rien à "basculer" pour elles — elles sont
vides tant qu'aucune donnée réelle n'a été saisie, jamais remplacées par un contenu de
démonstration.

## Conséquences de la première donnée réelle

Dès l'instant où le **premier** bien réel est créé (`creerBienAction`, via `/biens/nouveau`) :

- `listerBiens()` ne retourne plus jamais `data/biens.ts` — même si un seul bien réel existe et
  que la démonstration avait 2 biens mockés.
- `getBienById("bien-001")` (un ancien id mocké) retourne désormais `undefined` — le repository ne
  retombe sur le mock qu'en cas de **panne d'accès à la base elle-même**, jamais parce que l'id
  demandé ressemble à un mock. Toute page ou lien pointant vers un ancien id mocké affiche donc un
  404 après la bascule — comportement attendu, pas un bug.
- Le référentiel utilisé par le moteur de matching (`construireContexte`) ne contient plus que des
  biens réels : un rendez-vous dont le lieu correspond à un ancien bien mocké ne matchera plus
  rien.

Le même raisonnement s'applique indépendamment aux acquéreurs et aux actions.

## Comportement des identifiants mockés

Les ids mockés sont des chaînes arbitraires (`"bien-001"`, `"client-003"`, `"act-002"`), jamais
des UUID. Toute fonction de repository qui accepte un id en paramètre pour une requête filtrée
commence par une garde :

```ts
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_REGEX.test(id)) return [];  // ou undefined, selon la fonction
```

Cette garde évite une erreur de cast Postgres (`invalid input syntax for type uuid`) si un id
mocké est passé à une requête sur une colonne `uuid` — elle ne réintroduit **jamais** de contenu
mocké en réponse, elle retourne simplement "rien trouvé". Exemple concret : `terminerAction()`
sur un id d'action mockée (`"act-001"`) est un no-op silencieux, pas une erreur — cliquer
"Terminer" sur une action de démonstration ne fait rien d'observable, plutôt que de planter.

## Archivage : un axe orthogonal à la bascule démo/réel

Depuis ADR-012, `biens` et `acquereurs` portent une colonne `archive_le` (nullable). C'est un
**concept exclusivement réel** — un bien/acquéreur mocké ne peut jamais être archivé (aucun champ
équivalent dans `data/biens.ts`/`data/clients.ts`, et le CTA "Archiver" n'apparaît que sur une
entité réelle, même garde `UUID_REGEX` que "Modifier").

Deux filtres bien distincts s'appliquent donc en cascade sur `listerBiens()`/`listerClients()` :
1. **Démo vs réel** (ce document) : y a-t-il *au moins une ligne réelle*, peu importe son statut
   d'archivage ? Si oui, jamais de repli mock — même si cette unique ligne réelle est archivée.
2. **Actif vs archivé** (ADR-012, `docs/BUSINESS_RULES.md#archivage`) : parmi les lignes réelles,
   seules celles non archivées sont retournées par défaut.

Concrètement : archiver le dernier bien réel actif ne fait **pas** réapparaître les mocks —
`listerBiens()` retourne simplement `[]`, et le mode reste "réel" (`getBienById("bien-001")`
continue de renvoyer `undefined`). C'est `listerBiensArchives()` (aucun repli mock non plus) qui
permet de consulter ce bien via `/biens?archives=1`.

## Fonctionnalités encore mock-only

Aucun équivalent réel n'existe à ce jour pour :

- **`data/dossier.ts` (`DossierBien`)** — historique manuscrit, notes en un seul bloc de texte,
  documents, visites effectuées. Concerne uniquement les deux biens mockés historiques
  (`bien-001`, `bien-002`) ; un bien réel n'a jamais de `DossierBien`. Trois de ses quatre
  dimensions ont depuis reçu un équivalent réel dérivé indépendant : Historique
  (`deriverHistoriqueBien`), Notes (`notes_bien`) et Visites → Effectuées
  (`comptes_rendus_visite`) — voir `docs/BUSINESS_RULES.md`. **Documents** reste 100% mock, sans
  aucun équivalent réel (détaillé dans `docs/KNOWN_LIMITATIONS.md`).
- **`data/preparations.ts`** — une seule préparation de visite entièrement curatée à la main
  (`prep-rdv-001`, couple bien Oberkampf / acquéreurs Dubois). Pour tout autre couple bien/
  acquéreur, `construirePreparationMinimale()` (`visites/[id]/preparer/page.tsx`) prend le relais
  avec uniquement des faits réels — jamais une tentative de reproduire le contenu curaté.
- **`data/agenda.ts` (`rendezVousDuJour`)** — 3 rendez-vous mockés, utilisés par `getAgendaSemaine()`
  quand Google Calendar n'est pas connecté ou indisponible, et par l'onglet "Visites → À venir" de
  `BienTabs` (qui ne lit **que** ce mock, jamais `getAgendaSemaine()` — limite documentée dans
  `docs/KNOWN_LIMITATIONS.md`).

## Pour aller plus loin

- Schéma des tables concernées : `docs/DATA_MODEL.md`
- Détail des règles qui consomment ces données (matching, mémoire du dossier, historique) :
  `docs/BUSINESS_RULES.md`
- Limites connues liées au mode mock : `docs/KNOWN_LIMITATIONS.md`
- Décision d'architecture sur les identifiants texte vs FK réelles : `docs/adr/010-identifiants-texte-vs-fk-reelles.md`
- Décision d'architecture sur l'archivage : `docs/adr/012-archivage-timestamp-vs-statut.md`
