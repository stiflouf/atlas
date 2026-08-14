CREATE TABLE "secteurs_recherche_acquereur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"code_insee" text NOT NULL,
	"nom_commune" text NOT NULL,
	"code_postal" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secteurs_recherche_acquereur_id_code_insee_unique" UNIQUE("acquereur_id","code_insee")
);
--> statement-breakpoint
ALTER TABLE "biens" ADD COLUMN "code_insee_commune" text;--> statement-breakpoint
ALTER TABLE "secteurs_recherche_acquereur" ADD CONSTRAINT "secteurs_recherche_acquereur_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;