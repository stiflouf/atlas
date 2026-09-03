CREATE TABLE "reperes_relationnels_acquereur" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"categorie" text NOT NULL,
	"libelle" text NOT NULL,
	"provenance" text NOT NULL,
	"utilisable_communication" boolean DEFAULT false NOT NULL,
	"archive_le" timestamp with time zone,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone,
	CONSTRAINT "reperes_relationnels_acquereur_categorie_check" CHECK ("reperes_relationnels_acquereur"."categorie" IN ('preference_contact','preference_relationnelle','centre_interet','autre')),
	CONSTRAINT "reperes_relationnels_acquereur_provenance_check" CHECK ("reperes_relationnels_acquereur"."provenance" IN ('indique_par_le_client','observe_lors_d_un_echange','saisi_par_le_conseiller'))
);
--> statement-breakpoint
ALTER TABLE "reperes_relationnels_acquereur" ADD CONSTRAINT "reperes_relationnels_acquereur_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;