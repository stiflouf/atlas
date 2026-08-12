CREATE TABLE "offres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"montant" integer NOT NULL,
	"date_offre" date NOT NULL,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"date_validite" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offres_statut_check" CHECK ("offres"."statut" IN ('en_cours','acceptee','refusee','retiree'))
);
--> statement-breakpoint
ALTER TABLE "offres" ADD CONSTRAINT "offres_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offres" ADD CONSTRAINT "offres_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;