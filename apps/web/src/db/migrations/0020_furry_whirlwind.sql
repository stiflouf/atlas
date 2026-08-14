CREATE TABLE "configurations_automatisation" (
	"regle_code" text PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configurations_automatisation_regle_code_check" CHECK ("configurations_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis'
      ))
);
--> statement-breakpoint
CREATE TABLE "evenements_metier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_evenement" text NOT NULL,
	"compte_rendu_visite_id" uuid,
	"prospect_vendeur_id" uuid,
	"compromis_id" uuid,
	"survenu_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN ('visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe')),
	CONSTRAINT "evenements_metier_une_seule_cible_check" CHECK ((
        (case when "evenements_metier"."compte_rendu_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."compromis_id" is not null then 1 else 0 end)
      ) = 1)
);
--> statement-breakpoint
CREATE TABLE "executions_automatisation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regle_code" text NOT NULL,
	"evenement_id" uuid NOT NULL,
	"tache_id" uuid,
	"demarree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"reussie_le" timestamp with time zone,
	"echouee_le" timestamp with time zone,
	"erreur_technique" text,
	CONSTRAINT "executions_automatisation_regle_evenement_unique" UNIQUE("regle_code","evenement_id"),
	CONSTRAINT "executions_automatisation_regle_code_check" CHECK ("executions_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis'
      ))
);
--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_compte_rendu_visite_id_comptes_rendus_visite_id_fk" FOREIGN KEY ("compte_rendu_visite_id") REFERENCES "public"."comptes_rendus_visite"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_prospect_vendeur_id_prospects_vendeurs_id_fk" FOREIGN KEY ("prospect_vendeur_id") REFERENCES "public"."prospects_vendeurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_compromis_id_compromis_id_fk" FOREIGN KEY ("compromis_id") REFERENCES "public"."compromis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_evenement_id_evenements_metier_id_fk" FOREIGN KEY ("evenement_id") REFERENCES "public"."evenements_metier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_tache_id_taches_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."taches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_visite_unique" ON "evenements_metier" USING btree ("type_evenement","compte_rendu_visite_id") WHERE "evenements_metier"."compte_rendu_visite_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_prospect_vendeur_unique" ON "evenements_metier" USING btree ("type_evenement","prospect_vendeur_id") WHERE "evenements_metier"."prospect_vendeur_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_compromis_unique" ON "evenements_metier" USING btree ("type_evenement","compromis_id") WHERE "evenements_metier"."compromis_id" IS NOT NULL;--> statement-breakpoint
-- Seed des 4 règles V1 (ADR-032), toutes INACTIVES par défaut (correction n°4) : l'activation est
-- un geste explicite ultérieur depuis /automatisations, jamais silencieux au déploiement.
INSERT INTO "configurations_automatisation" ("regle_code", "active") VALUES
  ('suivi_apres_visite', false),
  ('suivi_apres_rdv_estimation', false),
  ('preparation_apres_mandat', false),
  ('preparation_dossier_notaire_apres_compromis', false);