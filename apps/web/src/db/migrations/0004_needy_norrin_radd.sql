CREATE TABLE "comptes_rendus_visite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"date_visite" date NOT NULL,
	"retour" text NOT NULL,
	"interet" text DEFAULT 'inconnu' NOT NULL,
	"prochaine_etape" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comptes_rendus_visite_interet_check" CHECK ("comptes_rendus_visite"."interet" IN ('interesse','a_reflechir','pas_interesse','inconnu'))
);
--> statement-breakpoint
ALTER TABLE "comptes_rendus_visite" ADD CONSTRAINT "comptes_rendus_visite_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comptes_rendus_visite" ADD CONSTRAINT "comptes_rendus_visite_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;