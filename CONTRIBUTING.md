# Contribuer à Atlas

Pour comprendre le projet avant de contribuer : [`docs/DEVELOPER_ONBOARDING.md`](docs/DEVELOPER_ONBOARDING.md).
Ce document ne le duplique pas — il couvre uniquement le workflow.

## État courant : code freeze V1

Depuis le tag `v1.0.0-rc1` (V1 Candidate techniquement validée, pilote réel pas encore autorisé),
seules ces catégories de changement sont autorisées :

- correction de bug bloquant ;
- sécurité ;
- stabilité (fiabilité des tests, build, infrastructure) ;
- correction nécessaire à une validation externe (Railway, Google, mobile, backup) ;
- configuration pilote ;
- documentation indispensable.

**Aucune nouvelle fonctionnalité produit** tant que le pilote réel n'est pas autorisé. Ce n'est pas
une règle éternelle — c'est l'état actuel de la candidate, voir
`docs/PILOT_RUNBOOK.md#10-code-freeze-à-partir-de-la-validation-v1-candidate`. Ce qui reste
explicitement hors scope V1/post-V1 : `docs/KNOWN_LIMITATIONS.md`.

## Workflow Git

```
feature/*  →  develop  →  domiora-demo         (courant)
develop    →  main     →  sparkling-rejoicing  (promotion, mission explicite uniquement)
```

Correspondance environnement ↔ branche ↔ autorisation d'écriture : **source canonique unique**,
`docs/PILOT_RUNBOOK.md#0-environnements-branches-et-autorisations-décriture-source-canonique` — ne
jamais la recopier ni la déduire d'un nom de service.

- Branche principale : `main` — elle déploie la **production personnelle réelle de Steven**.
- Branche de développement : `develop` — elle déploie l'instance de démonstration `domiora-demo`.
- **Ne jamais `git push origin main` dans un lot visant `develop`/`domiora-demo`.** Une promotion
  vers `main` fait l'objet d'une mission explicite distincte. Une suite de tests entièrement verte
  ne l'autorise pas.
- Ne jamais travailler directement sur `main`.
- **Jamais de force-push sur `main`.**
- Avant tout push : `git fetch origin`, vérifier l'absence de divergence. Si `origin/main` a
  avancé de façon incompatible, ne jamais reset/rebase/cherry-pick à l'aveugle — comprendre la
  divergence d'abord.
- Le tag `v1.0.0-rc1` est une référence immuable de la V1 Candidate — ne jamais le déplacer, le
  supprimer ou le recréer.
- Messages de commit : mode impératif, ligne de sujet courte (`fix(...)`, `feat(...)`,
  `docs(...)` — préfixes déjà utilisés dans l'historique du projet).

## Avant de modifier un invariant

**Lire l'ADR pertinente avant de toucher à quelque chose qui semble étrange.** Une grande partie du
code encode des décisions produit délibérées (voir la table des invariants dans
`docs/DEVELOPER_ONBOARDING.md`, Partie 4) — ce qui ressemble à une simplification possible est
souvent un choix déjà tranché et documenté. Si aucune ADR ne couvre le changement envisagé et qu'il
touche une décision structurante, en écrire une avant de coder (voir `docs/adr/` pour le format).

## Tests attendus

- `pnpm test` (Vitest) doit passer avant toute PR touchant `apps/web/src/`.
- `pnpm test:e2e` (Playwright, 2 smoke) doit être rejoué si le changement touche l'authentification,
  le câblage navigateur, ou le parcours documentaire/Pack Notaire.
- Jamais de test contre une base de production — voir le garde-fou décrit dans
  `docs/DEVELOPER_ONBOARDING.md`, Partie 4.

## Migrations

Toute modification de `src/db/schema.ts` doit être accompagnée d'une migration générée
(`pnpm db:generate`) et commitée dans `src/db/migrations/` — c'est ce SQL, pas le schéma Drizzle,
qui fait foi. Procédure de migration en production : `docs/PROCEDURE_MIGRATION_PRODUCTION.md`.

## Documentation

Toute règle métier nouvelle ou modifiée doit être reflétée dans `docs/BUSINESS_RULES.md` et/ou une
ADR. Toute limite volontaire nouvelle doit être ajoutée à `docs/KNOWN_LIMITATIONS.md`.

## Definition of Done

Checklist complète : `docs/DEVELOPER_ONBOARDING.md`, Partie 4. Résumé : règle métier comprise,
validation serveur conservée, garde d'auth conservée, invariant DB respecté, tests ciblés +
non-régression, build propre, doc à jour si nécessaire, migration documentée si applicable,
données de test nettoyées, `git status` propre.
