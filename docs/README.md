# Documentation Atlas — index

Table des matières de la documentation technique. Vision produit : `README.md` racine. Workflow de
contribution : `CONTRIBUTING.md` racine.

## Commencer ici

- [`DEVELOPER_ONBOARDING.md`](DEVELOPER_ONBOARDING.md) — porte d'entrée canonique pour tout
  nouvel ingénieur : comprendre Atlas, lancer le projet, architecture, invariants à ne pas casser.

## Architecture / modèle

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — stack technique, organisation des dossiers, flux
  UI → Server Action → Repository → PostgreSQL.
- [`DATA_MODEL.md`](DATA_MODEL.md) — schéma de données, table par table.
- [`FLOWS.md`](FLOWS.md) — quelques parcours utilisateur bout en bout.
- [`DEMO_VS_REAL.md`](DEMO_VS_REAL.md) — comment la bascule données mockées/réelles fonctionne.

## Métier

- [`BUSINESS_RULES.md`](BUSINESS_RULES.md) — règles métier détaillées, domaine par domaine.

## Décisions d'architecture

- [`adr/`](adr/) — une décision par sujet, jamais renumérotée. Voir la matrice
  « si tu touches X, lis d'abord Y » dans `DEVELOPER_ONBOARDING.md`.

## Sécurité

- [`adr/047-securisation-pilote-mono-conseiller.md`](adr/047-securisation-pilote-mono-conseiller.md)
  — auth Atlas, private-by-default, checklist de configuration avant pilote.

## Tests

- Niveaux Vitest/Playwright et commandes exactes : `DEVELOPER_ONBOARDING.md`, Partie 4.
- Garde-fou test/production : `../apps/web/src/db/resoudreDatabaseUrlTest.ts`.

## Exploitation

- [`PILOT_RUNBOOK.md`](PILOT_RUNBOOK.md) — point d'entrée opérationnel du pilote mono-conseiller.
- [`PROCEDURE_MIGRATION_PRODUCTION.md`](PROCEDURE_MIGRATION_PRODUCTION.md) — migrer la base de
  production en sécurité.

## Release

- [`CHANGELOG_V1.md`](CHANGELOG_V1.md) — ce qui a été livré, étape par étape.
- Tag `v1.0.0-rc1` — référence immuable de la V1 Candidate (voir `CONTRIBUTING.md`).

## Limitations

- [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) — ce qui est volontairement absent/incomplet,
  domaine par domaine.

## Reprise assistée (agent IA)

- [`AI_HANDOFF.md`](AI_HANDOFF.md) — état synthétique, pièges connus, décisions à ne pas rouvrir.
