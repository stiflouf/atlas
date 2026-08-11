# ADR-007 — Repositories comme frontière IO unique ; Server Components par défaut

**Statut :** Accepté
**Date :** 2026-08-11
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Depuis ADR-006, `apps/web` possède son propre schéma Postgres et l'utilise directement (pas
d'`apps/api` intermédiaire). Au fil des sprints (biens, acquéreurs, actions, notes, comptes
rendus de visite), un même schéma d'organisation s'est répété sans jamais être écrit noir sur
blanc : il mérite d'être documenté avant qu'un futur ajout ne s'en écarte par accident.

## Décision

### Repositories : seule couche autorisée à parler à Postgres

Chaque entité réelle a son fichier `src/lib/<entite>Repository.ts` (`bienRepository.ts`,
`clientRepository.ts`, `actionRepository.ts`, `noteBienRepository.ts`,
`compteRenduVisiteRepository.ts`, et `contexteRepository.ts` pour la mémoire de matching). Ce
sont les **seuls** fichiers du projet qui importent `@/db/client` et `@/db/schema`. Aucune page,
aucun composant, aucune Server Action n'exécute de requête Drizzle directement.

Un repository :
- traduit une ligne Postgres vers le type métier applicatif (`ligneVersXxx`), NULL Postgres
  devenant systématiquement `undefined` (jamais `false`/défaut — voir ADR-009) ;
- gère lui-même la bascule démo/réel quand elle existe (voir ADR-010 et `DEMO_VS_REAL.md`) ;
- ne valide jamais de règle métier (un titre vide, un budget négatif) — cette validation vit dans
  la Server Action appelante.

### Server Actions minces

`src/actions/*.ts` (`"use server"`) ne fait que : lire/valider les champs de `FormData`, appeler
une fonction de repository, `redirect()`. Jamais de logique de calcul ou de règle métier
complexe dans une Server Action — celle-ci vit dans `src/lib/*.ts` (repositories pour l'IO,
modules purs comme `actionPriority.ts`/`historiqueBien.ts`/`memoireDossier.ts` pour les règles
sans IO), testable indépendamment de Next.js.

### Server Components par défaut, JS client minimal

Toutes les pages (`src/app/**/page.tsx`) sont des Server Components asynchrones par défaut.
`"use client"` n'est utilisé que là où un état d'interaction est réellement nécessaire (onglets
de `BienTabs.tsx`, accordéon de `PrepObjections.tsx`). La bascule d'onglet, l'ajout d'une note ou
la terminaison d'une action passent par des `<form action={serverAction}>` HTML natifs plutôt que
par du fetch client — fonctionnels sans JavaScript côté navigateur (progressive enhancement).

## Alternatives écartées

**Requêtes Drizzle directement dans les pages/Server Actions :** aurait évité un fichier
supplémentaire par entité, mais aurait dispersé la logique de mapping NULL→undefined et de
bascule démo/réel à chaque point d'appel — source garantie de divergence au premier oubli.

**Couche API interne (route handlers `/api/*` appelés en `fetch` depuis les Server Components) :**
inutile tant qu'`apps/web` est le seul consommateur de ses propres données ; ADR-006 a déjà tranché
qu'`apps/web` reste propriétaire du schéma pour l'instant.

## Conséquences

- Tout ajout d'entité réelle suit le même moule : table dans `schema.ts`, repository dédié,
  Server Action mince, page Server Component.
- Auditer "qui touche Postgres" revient à lister `src/lib/*Repository.ts` — jamais `grep` sur tout
  `src/app/`.
- Un futur remplacement de Drizzle ou de Postgres par autre chose resterait localisé aux fichiers
  `*Repository.ts`.
