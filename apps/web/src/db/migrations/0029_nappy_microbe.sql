CREATE TABLE "transmissions_dossier_notaire" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"compromis_id" uuid NOT NULL,
	"cle_idempotence" uuid NOT NULL,
	"etude_nom" text NOT NULL,
	"destinataire_nom" text,
	"destinataire_email" text,
	"transmis_le" timestamp with time zone NOT NULL,
	"cree_par_email" text NOT NULL,
	"manifeste_version" integer DEFAULT 1 NOT NULL,
	"manifeste_snapshot" jsonb NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transmissions_dossier_notaire_cle_idempotence_unique" UNIQUE("cle_idempotence")
);
--> statement-breakpoint
ALTER TABLE "transmissions_dossier_notaire" ADD CONSTRAINT "transmissions_dossier_notaire_compromis_id_compromis_id_fk" FOREIGN KEY ("compromis_id") REFERENCES "public"."compromis"("id") ON DELETE no action ON UPDATE no action;