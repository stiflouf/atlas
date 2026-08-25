CREATE TABLE "photos_bien" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"cle_stockage" text NOT NULL,
	"nom_fichier_original" text NOT NULL,
	"type_mime_original" text NOT NULL,
	"taille_octets_original" integer NOT NULL,
	"hash_sha256" text NOT NULL,
	"ordre" integer NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_bien_type_mime_original_check" CHECK ("photos_bien"."type_mime_original" IN ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "photos_bien_taille_octets_original_check" CHECK ("photos_bien"."taille_octets_original" > 0),
	CONSTRAINT "photos_bien_ordre_check" CHECK ("photos_bien"."ordre" >= 0)
);
--> statement-breakpoint
ALTER TABLE "photos_bien" ADD CONSTRAINT "photos_bien_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photos_bien_bien_id_ordre_cree_le_id_idx" ON "photos_bien" USING btree ("bien_id","ordre","cree_le","id");