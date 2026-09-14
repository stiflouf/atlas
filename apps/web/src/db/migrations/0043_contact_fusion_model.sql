CREATE TABLE "contact_fusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_survivant_id" uuid NOT NULL,
	"contact_absorbe_id" uuid NOT NULL,
	"fusionne_le" timestamp with time zone DEFAULT now() NOT NULL,
	"fusionne_par_sub" text,
	"fusionne_par_email" text,
	"identite_avant_survivant" jsonb NOT NULL,
	"identite_avant_absorbe" jsonb NOT NULL,
	"identite_finale" jsonb NOT NULL,
	"choix_par_champ" jsonb NOT NULL,
	"ids_deplaces" jsonb NOT NULL,
	"avertissements_acquittes" jsonb NOT NULL,
	CONSTRAINT "contact_fusions_pas_soi_meme_check" CHECK ("contact_fusions"."contact_survivant_id" <> "contact_fusions"."contact_absorbe_id")
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "fusionne_dans_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "fusionne_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contact_fusions" ADD CONSTRAINT "contact_fusions_contact_survivant_id_contacts_id_fk" FOREIGN KEY ("contact_survivant_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fusions" ADD CONSTRAINT "contact_fusions_contact_absorbe_id_contacts_id_fk" FOREIGN KEY ("contact_absorbe_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_fusions_survivant_idx" ON "contact_fusions" USING btree ("contact_survivant_id");--> statement-breakpoint
CREATE INDEX "contact_fusions_absorbe_idx" ON "contact_fusions" USING btree ("contact_absorbe_id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_fusionne_dans_contact_id_contacts_id_fk" FOREIGN KEY ("fusionne_dans_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_fusionne_dans_idx" ON "contacts" USING btree ("fusionne_dans_contact_id") WHERE "contacts"."fusionne_dans_contact_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_fusion_coherente_check" CHECK (("contacts"."fusionne_dans_contact_id" IS NULL) = ("contacts"."fusionne_le" IS NULL));--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_fusion_pas_soi_meme_check" CHECK ("contacts"."fusionne_dans_contact_id" IS NULL OR "contacts"."fusionne_dans_contact_id" <> "contacts"."id");