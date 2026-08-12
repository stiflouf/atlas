CREATE TABLE "remuneration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compromis_id" uuid NOT NULL,
	"montant_honoraires_total_centimes" integer,
	"montant_remuneration_conseiller_centimes" integer NOT NULL,
	"date_encaissement_prevue" date,
	"date_encaissement_reelle" date,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone,
	CONSTRAINT "remuneration_compromis_id_unique" UNIQUE("compromis_id"),
	CONSTRAINT "remuneration_montant_conseiller_positif_check" CHECK ("remuneration"."montant_remuneration_conseiller_centimes" > 0),
	CONSTRAINT "remuneration_montant_honoraires_positif_check" CHECK ("remuneration"."montant_honoraires_total_centimes" IS NULL OR "remuneration"."montant_honoraires_total_centimes" > 0)
);
--> statement-breakpoint
ALTER TABLE "remuneration" ADD CONSTRAINT "remuneration_compromis_id_compromis_id_fk" FOREIGN KEY ("compromis_id") REFERENCES "public"."compromis"("id") ON DELETE cascade ON UPDATE no action;