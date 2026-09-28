-- ATTENTION — ce fichier a été COMPLÉTÉ À LA MAIN après `drizzle-kit generate`, même précédent que
-- 0032. Le SQL généré était : DROP CONSTRAINT, puis `ADD COLUMN "workspace_id" text NOT NULL`, puis
-- FK, puis nouvelle UNIQUE. Sur une base CONTENANT DÉJÀ DES LIGNES, cet `ADD COLUMN ... NOT NULL`
-- sans DEFAULT échoue immédiatement : drizzle-kit ne peut pas deviner un backfill. Les étapes 1, 3
-- et 4 ci-dessous sont donc écrites à la main. Ne jamais régénérer ce fichier sans les ré-appliquer.
--
-- WORKSPACE_SCOPING_V2D1 (ADR-054, question ouverte n°4) — `memoire_contextuelle` devient
-- WORKSPACE-OWNED : `workspace_id` NOT NULL, et l'unicité passe de (source, identifiant_externe)
-- au TRIPLET (workspace_id, source, identifiant_externe).
--
-- Pourquoi maintenant : l'ancienne unicité était GLOBALE. Deux workspaces ne pouvaient pas
-- mémoriser le même élément externe, et l'`ON CONFLICT (source, identifiant_externe)` du writer
-- faisait écraser la décision humaine d'un workspace par celle d'un autre — puis la relecture
-- rendait à l'un le `bien_id` de l'autre. C'est la même faille que 0054 a refermée pour
-- `configurations_automatisation`, une table plus loin.
--
-- Pourquoi un BACKFILL, contrairement à 0054 : cette colonne n'existait pas. Elle ne peut pas être
-- dérivée ligne à ligne — `bien_id`/`client_id` sont du texte SANS FK, nullables (une décision
-- « ignore » a `bien_id` NULL par construction), et peuvent porter un id de catalogue mocké. Aucune
-- jointure ne couvre l'ensemble des lignes.
--
-- Ce qui rend le backfill déterministe n'est donc pas la donnée, c'est le CONTEXTE HISTORIQUE :
-- avant ce lot, une identité n'a jamais pu appartenir qu'à un seul workspace
-- (`exigerWorkspaceCourant` échoue explicitement au-delà, ADR-054 étape 4), et toutes les lignes
-- existantes ont été écrites dans ce monde-là. Le même raisonnement, déjà appliqué par 0032 à une
-- vingtaine de tables.
--
-- Mais ce raisonnement cesse d'être vrai dès qu'un second workspace existe. La migration le VÉRIFIE
-- au lieu de le supposer : s'il y a autre chose qu'exactement un workspace, elle ÉCHOUE avec un
-- message actionnable plutôt que de ranger des lignes dans un périmètre que personne n'a désigné.
-- Rien n'est jamais écrit « par défaut ».
--
-- Ordre contraint, ne jamais réordonner :
--   1. garde (exactement un workspace)  ->  2. ADD COLUMN nullable  ->  3. backfill
--   -> 4. vérification zéro NULL  ->  5. SET NOT NULL + FK  ->  6. bascule de l'unicité.

-- 1. GARDE — la seule hypothèse de cette migration, vérifiée avant d'écrire quoi que ce soit.
--    Sautée s'il n'y a aucune ligne à backfiller : une base neuve n'a rien à réinterpréter, et
--    elle n'a pas à dépendre du nombre de workspaces déjà créés.
DO $$
DECLARE
  nb_workspaces integer;
  nb_lignes integer;
BEGIN
  SELECT count(*) INTO nb_lignes FROM "memoire_contextuelle";
  IF nb_lignes = 0 THEN
    RETURN;
  END IF;

  SELECT count(*) INTO nb_workspaces FROM "workspaces";
  IF nb_workspaces <> 1 THEN
    RAISE EXCEPTION
      'Migration 0055 refusée : % ligne(s) de memoire_contextuelle à rattacher, mais % workspace(s) existent. Le rattachement historique n''est déterministe QUE s''il y a exactement un workspace. Rattacher ces lignes à la main (ou les purger : les lignes statut_validation = ''auto'' sont un cache recalculable) avant de rejouer.',
      nb_lignes, nb_workspaces;
  END IF;
END $$;--> statement-breakpoint

-- 2. Colonne posée NULLABLE : le backfill a besoin d'exister avant la contrainte.
ALTER TABLE "memoire_contextuelle" ADD COLUMN "workspace_id" text;--> statement-breakpoint

-- 3. BACKFILL — l'unique workspace, lu en base, jamais le littéral 'default' écrit en dur. Si le
--    workspace historique porte un autre id, c'est celui-là qui est utilisé.
UPDATE "memoire_contextuelle" SET "workspace_id" = (SELECT "id" FROM "workspaces") WHERE "workspace_id" IS NULL;--> statement-breakpoint

-- 4. VÉRIFICATION — ceinture et bretelles : le SET NOT NULL de l'étape 5 échouerait de toute façon,
--    mais avec un message Postgres générique. Celui-ci dit ce qui s'est passé.
DO $$
DECLARE
  nb_null integer;
BEGIN
  SELECT count(*) INTO nb_null FROM "memoire_contextuelle" WHERE "workspace_id" IS NULL;
  IF nb_null > 0 THEN
    RAISE EXCEPTION 'Migration 0055 interrompue : % ligne(s) de memoire_contextuelle sans workspace_id après backfill.', nb_null;
  END IF;
END $$;--> statement-breakpoint

-- 5. Contrainte réelle. Aucun DEFAULT n'a jamais été posé : il n'y en a donc aucun à retirer — un
--    oubli applicatif doit échouer à l'insertion, jamais atterrir dans le workspace historique.
ALTER TABLE "memoire_contextuelle" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memoire_contextuelle" ADD CONSTRAINT "memoire_contextuelle_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 6. Bascule de l'unicité. L'ancienne est STRICTEMENT plus contraignante que la nouvelle : aucune
--    ligne existante ne peut violer le triplet, la bascule ne peut pas échouer sur les données.
ALTER TABLE "memoire_contextuelle" DROP CONSTRAINT "memoire_contextuelle_source_identifiant_externe_unique";--> statement-breakpoint
ALTER TABLE "memoire_contextuelle" ADD CONSTRAINT "memoire_contextuelle_workspace_source_identifiant_unique" UNIQUE("workspace_id","source","identifiant_externe");
