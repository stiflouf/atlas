CREATE TABLE "documents_bien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"nom" text NOT NULL,
	"categorie" text DEFAULT 'autre' NOT NULL,
	"nom_fichier_original" text NOT NULL,
	"cle_stockage" text NOT NULL,
	"taille_octets" integer NOT NULL,
	"type_mime" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_bien_categorie_check" CHECK ("documents_bien"."categorie" IN ('mandat','diagnostic','copropriete','technique','commercial','compromis','autre'))
);
--> statement-breakpoint
ALTER TABLE "documents_bien" ADD CONSTRAINT "documents_bien_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;