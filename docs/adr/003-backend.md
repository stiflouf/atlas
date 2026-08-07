# ADR-003 — Backend : Python + FastAPI + PostgreSQL

**Statut :** Accepté
**Date :** 2026-08-07
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Python est incontournable pour la couche IA — c'est là que vit l'écosystème LLM (SDK Anthropic, embeddings, agents). Le backend API doit donc être Python pour ne pas créer une fracture inutile.

## Décision

- **API :** FastAPI (Python)
- **Base de données :** PostgreSQL
- **pgvector :** différé — extension ajoutée uniquement lorsqu'on a réellement besoin de mémoire sémantique ou de recherche par embeddings
- **Worker IA :** application Python séparée dans `apps/worker/`, distincte de `apps/api/`

La séparation `api` / `worker` est intentionnelle : les tâches IA sont longues (timeout LLM), consomment plus de ressources, et ont un cycle de vie différent des requêtes REST synchrones. Séparer permet de scaler indépendamment.

## Alternatives écartées

**Node.js/TypeScript pour l'API :** monolangue JS séduisant, mais l'écosystème Python pour les LLM n'a pas d'équivalent JS mature. Le compromis ne vaut pas.

**MongoDB :** flexibilité du schéma attrayante, mais PostgreSQL + JSONB couvre nos besoins sans sacrifier les relations, les transactions et la maturité opérationnelle.

## Conséquences

- Split Python / TypeScript : le schéma OpenAPI de FastAPI devient la source de vérité partagée
- Option à activer dès que l'API stabilise : générer des types TypeScript depuis le schéma OpenAPI (`openapi-typescript`) pour éviter la désynchronisation
- pgvector s'ajoute comme extension PostgreSQL sans migration structurelle
- Sprint 1 : `apps/api/` et `apps/worker/` n'existent pas
