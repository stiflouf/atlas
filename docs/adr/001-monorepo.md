# ADR-001 — Monorepo avec Turborepo

**Statut :** Accepté
**Date :** 2026-08-07
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Atlas est composé de plusieurs applications (frontend web, API backend, worker IA) qui partagent des types, des configurations et évoluent ensemble. Deux options principales : monorepo ou multi-repo.

## Décision

Monorepo géré avec **Turborepo** comme orchestrateur de build et **pnpm workspaces** pour la gestion des packages.

Structure cible :
- `apps/` — applications déployables (web, api, worker)
- `packages/` — packages partagés (ui, types, config)
- `docs/` — documentation produit et ADR
- `infra/` — infrastructure (Docker, scripts de déploiement)

## Alternatives écartées

**Multi-repo :** coordination pénible sur une petite équipe, partage de types complexe, refactoring cross-services difficile.

**Nx :** plus puissant mais significativement plus complexe à configurer et maintenir. Turborepo est suffisant.

## Conséquences

- Pipeline de build à configurer dans `turbo.json` (ne rebuilder que ce qui a changé)
- CI/CD doit comprendre la structure workspace
- La racine du repo ne contient pas de code applicatif
- Sprint 1 : seul `apps/web/` est créé — le reste est ajouté au besoin
