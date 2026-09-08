# Documentation Atlas — index

Table des matières de la documentation technique. Vision produit : `README.md` racine. Workflow de
contribution : `CONTRIBUTING.md` racine.

## Commencer ici

- [`DEVELOPER_ONBOARDING.md`](DEVELOPER_ONBOARDING.md) — porte d'entrée canonique pour tout
  nouvel ingénieur : comprendre Atlas, lancer le projet, architecture, invariants à ne pas casser.

## Architecture / modèle

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — stack technique, organisation des dossiers, flux
  UI → Server Action → Repository → PostgreSQL. **Daté du 2026-08-11 et partiellement obsolète** :
  voir l'avertissement en tête du fichier, et l'audit ci-dessous pour l'état observé.
- [`audits/DOMIORA-STRATEGIC-ARCHITECTURE-AUDIT-2026-09.md`](audits/DOMIORA-STRATEGIC-ARCHITECTURE-AUDIT-2026-09.md)
  — audit stratégique du 2026-09-08 : état réellement observé, modèle de données, inventaire
  fonctionnel, couplage IAD, risques architecturaux.
- [`PLATFORM_BOUNDARIES.md`](PLATFORM_BOUNDARIES.md) — frontières de plateforme cibles
  (CORE / CONNECTORS / SYNC ENGINE / INTELLIGENCE / AUTOMATIONS / PACKS) et sens des dépendances.
  Carte de lecture uniquement — les décisions sont dans ADR-054/055/056, **non implémentées**.
- [`DATA_MODEL.md`](DATA_MODEL.md) — schéma de données, table par table.
- [`FLOWS.md`](FLOWS.md) — quelques parcours utilisateur bout en bout.
- [`DEMO_VS_REAL.md`](DEMO_VS_REAL.md) — comment la bascule données mockées/réelles fonctionne.

## Métier

- [`BUSINESS_RULES.md`](BUSINESS_RULES.md) — règles métier détaillées, domaine par domaine.

## Décisions d'architecture

- [`adr/README.md`](adr/README.md) — format d'une ADR, règle Scalabilité/Réversibilité pour les
  futures ADR importantes.
- [`adr/`](adr/) — une décision par sujet, jamais renumérotée. Voir la matrice
  « si tu touches X, lis d'abord Y » dans `DEVELOPER_ONBOARDING.md`.
- [`adr/051-portabilite-reversibilite-montee-en-charge.md`](adr/051-portabilite-reversibilite-montee-en-charge.md)
  — principes transversaux (portabilité, réversibilité, montée en charge) pour les décisions
  futures ; aucune implémentation, le pilote reste la priorité immédiate.

### Fondations multi-source / multi-utilisateur (2026-09-08, aucune implémentation)

Trois décisions à prendre avant tout connecteur et avant toute ouverture multi-utilisateur. Elles
ne changent aucun comportement actuel et n'ajoutent aucune migration.

- [`adr/054-appartenance-workspace-multi-utilisateur.md`](adr/054-appartenance-workspace-multi-utilisateur.md)
  — l'unité racine d'appartenance est le **workspace** ; IDENTITY / OWNERSHIP / ACCESS / SECRETS
  sont quatre concepts distincts ; toute nouvelle table porte son appartenance dès sa création.
- [`adr/055-modele-canonique-contact-projets-mandat-interaction.md`](adr/055-modele-canonique-contact-projets-mandat-interaction.md)
  — séparation **personne ↔ projet** (le contact n'a aucun rôle stocké), le **mandat** devient une
  entité, les interactions convergent par read model plutôt que par fusion de tables.
- [`adr/056-identite-externe-provenance-frontiere-connecteur.md`](adr/056-identite-externe-provenance-frontiere-connecteur.md)
  — l'identité canonique reste interne ; références externes N:1 ; provenance hybride avec verrous
  de champs ; capacités de connecteur ; frontière CORE / CONNECTOR / SYNC ENGINE.

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
