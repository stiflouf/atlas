CREATE TABLE "runs_scan_automatisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regle_code" text NOT NULL,
	"demarre_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone,
	"nombre_candidats" integer,
	"nombre_occurrences_creees" integer,
	"erreur_technique" text,
	CONSTRAINT "runs_scan_automatisation_regle_code_check" CHECK ("runs_scan_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur'
      ))
);
--> statement-breakpoint
ALTER TABLE "configurations_automatisation" DROP CONSTRAINT "configurations_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "executions_automatisation" DROP CONSTRAINT "executions_automatisation_regle_code_check";--> statement-breakpoint
DROP INDEX "evenements_metier_prospect_vendeur_unique";--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD COLUMN "seuil_jours_inactivite" integer;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "ancre_cycle" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_inactivite_prospect_vendeur_unique" ON "evenements_metier" USING btree ("type_evenement","prospect_vendeur_id","ancre_cycle") WHERE "evenements_metier"."type_evenement" = 'inactivite_prospect_vendeur';--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_prospect_vendeur_unique" ON "evenements_metier" USING btree ("type_evenement","prospect_vendeur_id") WHERE "evenements_metier"."prospect_vendeur_id" IS NOT NULL AND "evenements_metier"."type_evenement" <> 'inactivite_prospect_vendeur';--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_seuil_positif_check" CHECK ("configurations_automatisation"."seuil_jours_inactivite" IS NULL OR "configurations_automatisation"."seuil_jours_inactivite" > 0);--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_regle_code_check" CHECK ("configurations_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur'
      ));--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_regle_code_check" CHECK ("executions_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur'
      ));--> statement-breakpoint
-- Seed de la 5e règle V1 (ADR-033), inactive par défaut (même convention que les 4 règles
-- ADR-032) : seuil laissé NULL, l'activation reste refusée tant qu'un seuil valide n'a pas été
-- renseigné explicitement depuis /automatisations.
INSERT INTO "configurations_automatisation" ("regle_code", "active") VALUES
  ('inactivite_prospect_vendeur', false);