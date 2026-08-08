CREATE TABLE "connexions_google" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"refresh_token_chiffre" text NOT NULL,
	"scope" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memoire_contextuelle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"type_element" text NOT NULL,
	"identifiant_externe" text NOT NULL,
	"bien_id" text,
	"client_id" text,
	"type_metier" text DEFAULT 'autre' NOT NULL,
	"confidence_bien" real,
	"confidence_client" real,
	"confidence_type" real,
	"overall_confidence" real NOT NULL,
	"statut_validation" text DEFAULT 'auto' NOT NULL,
	"empreinte_contenu" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memoire_contextuelle_source_identifiant_externe_unique" UNIQUE("source","identifiant_externe"),
	CONSTRAINT "memoire_contextuelle_type_metier_check" CHECK ("memoire_contextuelle"."type_metier" IN ('visite','estimation','appel','signature','prospection','autre')),
	CONSTRAINT "memoire_contextuelle_statut_validation_check" CHECK ("memoire_contextuelle"."statut_validation" IN ('auto','confirme','corrige','ignore'))
);
