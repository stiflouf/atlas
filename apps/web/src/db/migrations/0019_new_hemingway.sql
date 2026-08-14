CREATE TABLE "envois_email" (
	"id" uuid PRIMARY KEY NOT NULL,
	"destinataire_email" text NOT NULL,
	"objet" text NOT NULL,
	"contenu_hash" text NOT NULL,
	"fournisseur" text DEFAULT 'gmail' NOT NULL,
	"bien_id" uuid,
	"tache_id" uuid,
	"origine_intention" text,
	"gmail_message_id" text,
	"demarre_le" timestamp with time zone DEFAULT now() NOT NULL,
	"reussi_le" timestamp with time zone,
	"echoue_le" timestamp with time zone,
	"incertain_le" timestamp with time zone,
	"erreur_technique" text,
	CONSTRAINT "envois_email_fournisseur_check" CHECK ("envois_email"."fournisseur" IN ('gmail')),
	CONSTRAINT "envois_email_origine_intention_check" CHECK ("envois_email"."origine_intention" IS NULL OR "envois_email"."origine_intention" IN (
        'relance_prospect_vendeur','suivi_rdv_estimation','suivi_acquereur','suivi_visite',
        'demande_document_manquant','relance_piece_a_verifier','message_compromis','message_notaire'
      ))
);
--> statement-breakpoint
ALTER TABLE "envois_email" ADD CONSTRAINT "envois_email_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envois_email" ADD CONSTRAINT "envois_email_tache_id_taches_id_fk" FOREIGN KEY ("tache_id") REFERENCES "public"."taches"("id") ON DELETE set null ON UPDATE no action;