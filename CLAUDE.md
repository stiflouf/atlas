# Atlas — instructions pour Claude Code

Point d'entrée des agents travaillant sur ce dépôt. Ce fichier ne duplique aucune règle : il
renvoie vers les documents qui font foi. En cas de divergence, le document cité a raison, et ce
fichier doit être corrigé.

## Documents à lire avant de travailler

- `CONTRIBUTING.md` : workflow Git, état du code freeze V1, tests attendus, migrations, Definition
  of Done.
- `docs/DEVELOPER_ONBOARDING.md` : démarrage, architecture, invariants (Partie 4), matrice « si tu
  touches X, lis d'abord Y » (Partie 5).
- `docs/AI_HANDOFF.md` : état synthétique pour une reprise par un agent.
- `docs/PILOT_RUNBOOK.md` §0 : correspondance canonique environnement, branche et autorisation
  d'écriture.
- `docs/KNOWN_LIMITATIONS.md` : ce qui est volontairement absent. Une absence listée n'est pas un
  oubli.
- `docs/adr/` : lire l'ADR concernée avant de modifier un comportement qui semble étrange.
- `apps/web/CLAUDE.md` (via `apps/web/AGENTS.md`) : la version de Next.js utilisée diffère des
  connaissances d'entraînement ; lire `apps/web/node_modules/next/dist/docs/` avant d'écrire du
  code Next.js.

## Règles Git

- Toute modification part d'une branche `feature/*` créée depuis `origin/develop`.
- Jamais de commit ni de push direct sur `develop` ou `main`, jamais de force-push.
- `develop` déploie l'instance de démonstration `domiora-demo` ; `main` déploie la production
  personnelle réelle. Une promotion vers `main` est toujours une mission explicite distincte.
- Pas de pull request ni de merge sans accord explicite.
- Messages de commit à l'impératif, préfixes de l'historique (`fix(...)`, `feat(...)`,
  `docs(...)`, `chore(...)`).

## Données et secrets

- Jamais de données ni de secrets de production, jamais de base distante.
- Les tests utilisent uniquement la base locale `atlas_test` (garde-fou
  `apps/web/src/db/resoudreDatabaseUrlTest.ts`).
- Les migrations commitées dans `apps/web/src/db/migrations/` font foi ; toute modification de
  `schema.ts` s'accompagne d'une migration générée.

## Commandes

Depuis la racine : `pnpm install --frozen-lockfile` (jamais depuis `apps/web`, qui contient un
`pnpm-workspace.yaml` propre).

Depuis `apps/web` :

```bash
npx tsc --noEmit -p tsconfig.json   # typecheck
pnpm test                           # Vitest, base atlas_test
pnpm build                          # build Next.js
pnpm test:e2e                       # 2 smoke Playwright (Chromium Cloud : ATLAS_E2E_CHROMIUM_PATH)
```

## Sessions Claude Code Cloud

Le hook `.claude/hooks/session-start.sh` (déclaré dans `.claude/settings.json`) prépare
automatiquement l'environnement : dépendances, PostgreSQL 16 local sans Docker, base `atlas_test`
migrée, Chromium préinstallé pour les smoke E2E. Il ne s'exécute que si `CLAUDE_CODE_REMOTE=true`. Détail et limitations :
`docs/DEVELOPER_ONBOARDING.md`, Partie 2, section « Sessions Claude Code Cloud ».
