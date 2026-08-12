# ADR-012 — Archivage : `archiveLe?: timestamp` plutôt qu'un statut enum

**Statut :** Accepté
**Date :** 2026-08-12
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le conseiller doit pouvoir sortir un bien ou un acquéreur des flux actifs (listes, matching, CTA
de création) sans supprimer la donnée ni casser les notes/actions/comptes rendus/historique déjà
liés. Deux modélisations étaient envisagées : une colonne `archiveLe?: timestamp` (nullable,
présente = archivé) ou une colonne `statut: "actif" | "archive"` (`NOT NULL`, `CHECK`, défaut
`'actif'`), sur le modèle de `actions.statut`/`biens.statut_mandat`.

## Décision

`archiveLe: timestamp("archive_le", { withTimezone: true })`, nullable, sans défaut, sur `biens`
et `acquereurs`. `NULL` = actif, non-`NULL` = archivé à cet instant. Même patron que
`actions.termineLe` déjà en place : un événement de cycle de vie binaire se représente par la date
à laquelle il survient, pas par une case à cocher.

Conséquences directes :
- **Listes** (`listerBiens()`/`listerClients()`) : filtrent `WHERE archive_le IS NULL` par défaut.
  Un catalogue entièrement archivé ne retombe jamais sur les mocks (le comptage de bascule
  démo↔réel porte sur toutes les lignes, archivées comprises — voir `docs/DEMO_VS_REAL.md`).
- **Lookup direct** (`getBienById()`/`getClientById()`) : inchangé, résout toujours une entité
  archivée — fiche, édition, notes/actions/comptes rendus/historique restent consultables.
- **Matching** : aucune modification de `lib/matching/*` nécessaire — le référentiel vient déjà de
  `listerBiens()`/`listerClients()`, donc les archivés en sont exclus par construction.
- **Restauration** : `UPDATE ... SET archive_le = NULL` — triviale, symétrique, aucune perte
  d'information (contrairement à une suppression).

## Alternatives écartées

**Statut enum (`actif`/`archive`)** : même comportement de filtrage, mais introduit une colonne
`NOT NULL` + `CHECK` pour représenter un état binaire, et perd l'information "depuis quand" à
moins d'ajouter *quand même* un timestamp en complément — ce qui revient à faire cohabiter deux
colonnes pour une seule idée. N'aurait apporté un avantage que si plusieurs états distincts de
"non-actif" étaient nécessaires (ex. "archivé — vendu" vs "archivé — perdu") ; aucun besoin de
cette granularité n'a été exprimé.

**Suppression physique** : explicitement écartée — l'objectif est de sortir des flux actifs, pas
de perdre l'historique. Une suppression aurait aussi déclenché `ON DELETE CASCADE` sur
`notes_bien`/`comptes_rendus_visite`, incompatible avec "notes/actions/comptes rendus historiques
restent consultables".

## Conséquences

- Tout nouvel état de cycle de vie binaire sur une entité réelle (créé/pas créé, terminé/pas
  terminé, archivé/pas archivé) suit ce patron : timestamp nullable, jamais un enum à deux valeurs.
- Les Server Actions qui créent une entité dépendante (note, compte rendu, action) doivent vérifier
  explicitement `archiveLe` via `getBienById()`/`getClientById()` avant insertion — cette
  vérification n'est pas automatique, elle doit être répétée à chaque nouveau point de création
  liée à un bien/acquéreur.
