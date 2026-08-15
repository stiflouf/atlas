CREATE TABLE "compatibilites_a_resynchroniser" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid,
	"acquereur_id" uuid,
	"demandee_le" timestamp with time zone DEFAULT now() NOT NULL,
	"traitee_le" timestamp with time zone,
	"derniere_tentative_le" timestamp with time zone,
	"derniere_erreur" text,
	CONSTRAINT "compatibilites_a_resynchroniser_une_seule_source_check" CHECK ((
        (case when "compatibilites_a_resynchroniser"."bien_id" is not null then 1 else 0 end) +
        (case when "compatibilites_a_resynchroniser"."acquereur_id" is not null then 1 else 0 end)
      ) = 1)
);
--> statement-breakpoint
CREATE TABLE "compatibilites_bien_acquereur_etat" (
	"bien_id" uuid NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"dernier_statut" text NOT NULL,
	"dans_perimetre_actif" boolean DEFAULT true NOT NULL,
	"cycle_compatibilite" integer DEFAULT 0 NOT NULL,
	"observe_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compatibilites_bien_acquereur_etat_bien_id_acquereur_id_pk" PRIMARY KEY("bien_id","acquereur_id"),
	CONSTRAINT "compatibilites_bien_acquereur_etat_statut_check" CHECK ("compatibilites_bien_acquereur_etat"."dernier_statut" IN ('compatible','incompatible','a_verifier')),
	CONSTRAINT "compatibilites_bien_acquereur_etat_cycle_positif_check" CHECK ("compatibilites_bien_acquereur_etat"."cycle_compatibilite" >= 0)
);
--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_une_seule_cible_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "bien_id" uuid;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "acquereur_id" uuid;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "cycle_compatibilite" integer;--> statement-breakpoint
ALTER TABLE "compatibilites_a_resynchroniser" ADD CONSTRAINT "compatibilites_a_resynchroniser_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibilites_a_resynchroniser" ADD CONSTRAINT "compatibilites_a_resynchroniser_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibilites_bien_acquereur_etat" ADD CONSTRAINT "compatibilites_bien_acquereur_etat_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compatibilites_bien_acquereur_etat" ADD CONSTRAINT "compatibilites_bien_acquereur_etat_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compatibilites_a_resynchroniser_bien_en_attente_unique" ON "compatibilites_a_resynchroniser" USING btree ("bien_id") WHERE "compatibilites_a_resynchroniser"."bien_id" IS NOT NULL AND "compatibilites_a_resynchroniser"."traitee_le" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "compatibilites_a_resynchroniser_acquereur_en_attente_unique" ON "compatibilites_a_resynchroniser" USING btree ("acquereur_id") WHERE "compatibilites_a_resynchroniser"."acquereur_id" IS NOT NULL AND "compatibilites_a_resynchroniser"."traitee_le" IS NULL;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_compatibilite_unique" ON "evenements_metier" USING btree ("type_evenement","bien_id","acquereur_id","cycle_compatibilite") WHERE "evenements_metier"."type_evenement" = 'compatibilite_bien_acquereur_devenue_compatible';--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_bien_acquereur_ensemble_check" CHECK (("evenements_metier"."bien_id" IS NOT NULL) = ("evenements_metier"."acquereur_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_une_seule_cible_check" CHECK ((
        (case when "evenements_metier"."compte_rendu_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."compromis_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."bien_id" is not null and "evenements_metier"."acquereur_id" is not null then 1 else 0 end)
      ) = 1);