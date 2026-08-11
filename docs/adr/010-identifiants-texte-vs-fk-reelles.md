# ADR-010 — Identifiants texte vs clés étrangères réelles, et bascule démo → réel

**Statut :** Accepté
**Date :** 2026-08-11
**Décideurs :** Steven Gausset (CEO), CTO

## Contexte

Le schéma contient deux traitements différents pour référencer un bien ou un acquéreur depuis une
autre table :
- `memoire_contextuelle.bien_id`/`client_id` et `actions.bien_id`/`acquereur_id` : colonnes
  **`text`**, nullables, **sans** contrainte `REFERENCES`.
- `notes_bien.bien_id`, `comptes_rendus_visite.bien_id`/`acquereur_id` : colonnes **`uuid`**,
  **`NOT NULL`**, avec une vraie contrainte `REFERENCES ... ON DELETE CASCADE`.

Ce n'est pas une incohérence : c'est une conséquence directe de *quand* chaque table a été
introduite par rapport à la bascule démo → réel de `biens`/`acquereurs` (voir
`docs/DEMO_VS_REAL.md`).

## Décision

**`text` sans FK** quand la table doit pouvoir référencer soit un catalogue encore mocké
(`data/biens.ts`, id du type `"bien-001"`), soit un catalogue réel (`biens`, id UUID) — les deux
cohabitent tant que la bascule démo → réel n'est pas garantie franchie pour ce catalogue précis.
`memoire_contextuelle` (ADR-006) et `actions` sont dans ce cas : une action peut légitimement
référencer un bien qui n'a pas encore d'équivalent réel en base, et doit continuer à fonctionner
sans erreur (`UUID_REGEX.test(id)` gate côté repository avant toute requête filtrée par id, pour
ne jamais tenter un cast Postgres invalide sur un id mocké).

**`uuid` avec FK réelle** quand la table ne peut être alimentée que depuis un contexte où l'entité
référencée est déjà garantie réelle. `notes_bien` et `comptes_rendus_visite` sont dans ce cas :
leurs seuls points d'entrée UI (`biens/[id]/page.tsx`, `visites/[id]/preparer/page.tsx`) ont déjà
résolu un `Bien`/`ProfilAcquereur` réel avant de rendre le formulaire — il n'existe aucun chemin
pour créer une note ou un compte rendu sur un bien encore mocké. La contrainte FK apporte une
garantie d'intégrité réelle sans coût, puisque le cas qu'elle interdit ne peut pas survenir.

## Alternatives écartées

**FK réelle partout, y compris `actions`/`memoire_contextuelle` :** aurait empêché toute action
ou tout matching sur un bien/acquéreur encore mocké — cassant le mode démo, qui doit fonctionner
sans aucune ligne réelle en base.

**Migrer `data/biens.ts`/`data/clients.ts` en base dès maintenant pour homogénéiser :** hors
périmètre de chaque sprint concerné (voir ADR-006 : "Gérer ces catalogues en base n'est pas
nécessaire pour ce sprint") — le mode démo doit rester utilisable sans aucune donnée réelle.

## Conséquences

- Le choix `text`/pas de FK vs `uuid`/FK réelle pour un nouveau champ de référence doit se poser
  systématiquement en fonction d'une seule question : *"ce champ peut-il légitimement pointer
  vers une entité encore mockée ?"* Si oui → `text`, sans contrainte, avec garde `UUID_REGEX`
  côté repository. Si non → `uuid` avec `REFERENCES`.
- Le jour où `data/biens.ts`/`data/clients.ts` seront intégralement retirés (plus aucun mode
  démo), les colonnes `text` de `actions`/`memoire_contextuelle` pourront être migrées vers de
  vraies FK — pas avant, sous peine de casser le mode démo.
