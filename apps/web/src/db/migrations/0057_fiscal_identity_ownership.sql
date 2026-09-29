-- ATTENTION — fichier ÉCRIT À LA MAIN, même précédent que 0032, 0055 et 0056. `drizzle-kit
-- generate` produirait deux `ADD COLUMN ... NOT NULL` sans DEFAULT, qui échouent sur une base
-- contenant déjà des lignes : il ne peut pas deviner un backfill. Ne jamais régénérer ce fichier
-- sans ré-appliquer les gardes et les étapes de backfill ci-dessous.
--
-- FISCAL_IDENTITY_OWNERSHIP_V1 (ADR-054 §6 bis, tranché le 2026-09-08 ; ADR-023 §1) — le dossier
-- fiscal cesse d'être un SINGLETON D'INSTANCE et devient PERSONNEL, et les honoraires acquièrent
-- enfin un bénéficiaire nommé.
--
-- ── CE QUI ÉTAIT CASSÉ, ET POURQUOI LES DEUX MOITIÉS SONT INDISSOCIABLES ──
--
-- `dossier_fiscal` avait une PK à valeur constante (`DEFAULT 'default'`) et un reader sans aucun
-- paramètre : deux personnes partageaient donc un seul dossier. Pas seulement en lecture — les
-- UPSERT de `rfr_foyer` et `historique_amorcage` ciblent `(dossier_fiscal_id, annee)`, si bien que
-- la saisie de l'une ÉCRASAIT le revenu fiscal de référence du foyer de l'autre.
--
-- Mais rattacher le dossier sans attribuer les honoraires aurait produit pire que l'état actuel :
-- un dossier fiscal nominativement personnel, alimenté par le chiffre d'affaires de tout le monde.
-- `listerEncaissementsAnnee` ne joint même pas `biens` — elle n'a donc jamais eu le moindre
-- périmètre, pas même le workspace. D'où la seconde colonne, dans la même migration.
--
-- ── POURQUOI PAS `identite_sub` EN CLÉ PRIMAIRE (contrairement à `connexions_google`/0056) ──
--
-- `connexions_google` n'avait AUCUNE table fille : y déplacer la PK était gratuit. Ici trois filles
-- (`profil_fiscal`, `historique_amorcage`, `rfr_foyer`) référencent `dossier_fiscal.id` par FK.
-- Déplacer la PK imposerait de réécrire ces FK, donc une migration de données sur du RFR de foyer
-- SAISI À LA MAIN et non recalculable. ADR-023 §1 avait tranché d'avance : « il s'ajoute comme une
-- colonne sur `dossier_fiscal` SEULE — aucune des trois tables filles ni leurs contraintes UNIQUE
-- n'a besoin d'être retouchée ». Aucune FK fille n'est touchée par ce fichier.
--
-- ── STRATÉGIE LEGACY : BACKFILL GARDÉ, JAMAIS DE DROP ──
--
-- 0056 supprimait sa ligne legacy : un refresh token se reconstitue en un clic. Ici, c'est
-- l'inverse exact — RFR du foyer, quotient familial, historique d'amorçage et montants encaissés
-- sont saisis à la main. Un DROP serait une perte sèche. On backfille donc, mais SOUS GARDE.
--
-- Ce qui rend le backfill honnête n'est pas la donnée (aucune colonne d'auteur n'a jamais existé,
-- et ADR-054 refuse tout backfill d'auteur inventé) : c'est le CONTEXTE. Tant qu'une seule identité
-- humaine existe, lui attribuer l'historique est un constat, pas une supposition. Cette fenêtre se
-- referme au premier second humain — raison d'agir maintenant.
--
-- GARDE, et son écart assumé avec le brief d'audit : celui-ci proposait d'exiger « exactement UNE
-- ligne dans workspace_membres ». C'est trop strict et surtout ce n'est pas l'invariant utile : la
-- PK de cette table est COMPOSITE (workspace_id, identite_sub), donc une même personne appartenant
-- à deux workspaces y occupe déjà deux lignes sans la moindre ambiguïté. La propriété qui compte
-- est l'unicité de l'IDENTITÉ, pas le nombre de lignes. La garde porte donc sur
-- `count(DISTINCT identite_sub)`.

-- 1. GARDE — vérifiée AVANT toute écriture, et seulement s'il y a réellement quelque chose à
--    rattacher : une base neuve n'a rien à réinterpréter et ne doit pas dépendre de l'état des
--    appartenances.
DO $$
DECLARE
  nb_identites integer;
  nb_dossiers integer;
  nb_remunerations integer;
BEGIN
  SELECT count(*) INTO nb_dossiers FROM "dossier_fiscal";
  SELECT count(*) INTO nb_remunerations FROM "remuneration";
  IF nb_dossiers = 0 AND nb_remunerations = 0 THEN
    RETURN;
  END IF;

  SELECT count(DISTINCT "identite_sub") INTO nb_identites FROM "workspace_membres";
  IF nb_identites <> 1 THEN
    RAISE EXCEPTION
      'Migration 0057 refusée : % dossier(s) fiscal(aux) et % rémunération(s) à rattacher, mais % identité(s) distincte(s) dans workspace_membres. Le rattachement n''est honnête QUE s''il existe exactement une identité — aucune colonne du schéma ne dit qui a saisi ces données ni qui a perçu ces honoraires. Rattacher à la main avant de rejouer ; ne jamais choisir une identité par ordre arbitraire.',
      nb_dossiers, nb_remunerations, nb_identites;
  END IF;
END $$;--> statement-breakpoint

-- ─────────────────────────── A. dossier_fiscal ───────────────────────────

-- 2. Colonne posée NULLABLE : le backfill doit pouvoir s'exécuter avant la contrainte.
ALTER TABLE "dossier_fiscal" ADD COLUMN "identite_sub" text;--> statement-breakpoint

-- 3. BACKFILL — l'unique identité, LUE EN BASE. Jamais un littéral, jamais un LIMIT 1, jamais un
--    MIN/MAX : la sous-requête ne rend une valeur que parce que l'étape 1 a prouvé son unicité.
UPDATE "dossier_fiscal" SET "identite_sub" = (SELECT DISTINCT "identite_sub" FROM "workspace_membres") WHERE "identite_sub" IS NULL;--> statement-breakpoint

-- 4. VÉRIFICATION — le SET NOT NULL échouerait de toute façon, mais avec un message générique.
DO $$
DECLARE
  nb_null integer;
BEGIN
  SELECT count(*) INTO nb_null FROM "dossier_fiscal" WHERE "identite_sub" IS NULL;
  IF nb_null > 0 THEN
    RAISE EXCEPTION 'Migration 0057 interrompue : % dossier(s) fiscal(aux) sans identite_sub après backfill.', nb_null;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "dossier_fiscal" ALTER COLUMN "identite_sub" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "dossier_fiscal" ADD CONSTRAINT "dossier_fiscal_identite_sub_unique" UNIQUE("identite_sub");--> statement-breakpoint

-- 5. Le DEFAULT devient un piège dès qu'il existe deux dossiers : la seconde insertion entrerait en
--    collision de PK. L'identifiant est désormais généré par le repository.
ALTER TABLE "dossier_fiscal" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint

-- ─────────────────────────── B. remuneration ───────────────────────────

ALTER TABLE "remuneration" ADD COLUMN "beneficiaire_identite_sub" text;--> statement-breakpoint

UPDATE "remuneration" SET "beneficiaire_identite_sub" = (SELECT DISTINCT "identite_sub" FROM "workspace_membres") WHERE "beneficiaire_identite_sub" IS NULL;--> statement-breakpoint

DO $$
DECLARE
  nb_null integer;
BEGIN
  SELECT count(*) INTO nb_null FROM "remuneration" WHERE "beneficiaire_identite_sub" IS NULL;
  IF nb_null > 0 THEN
    RAISE EXCEPTION 'Migration 0057 interrompue : % rémunération(s) sans bénéficiaire après backfill.', nb_null;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "remuneration" ALTER COLUMN "beneficiaire_identite_sub" SET NOT NULL;
