CREATE TABLE "compromis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"offre_id" uuid,
	"prix_convenu" integer NOT NULL,
	"date_signature" date NOT NULL,
	"date_acte" date,
	"statut" text DEFAULT 'en_cours' NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compromis_statut_check" CHECK ("compromis"."statut" IN ('en_cours','realise','annule'))
);
--> statement-breakpoint
ALTER TABLE "compromis" ADD CONSTRAINT "compromis_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compromis" ADD CONSTRAINT "compromis_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compromis" ADD CONSTRAINT "compromis_offre_id_offres_id_fk" FOREIGN KEY ("offre_id") REFERENCES "public"."offres"("id") ON DELETE set null ON UPDATE no action;