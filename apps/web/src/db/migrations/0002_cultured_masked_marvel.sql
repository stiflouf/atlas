CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titre" text NOT NULL,
	"contexte" text,
	"type" text DEFAULT 'autre' NOT NULL,
	"statut" text DEFAULT 'a_faire' NOT NULL,
	"priorite" text DEFAULT 'normale' NOT NULL,
	"echeance" date,
	"bien_id" text,
	"acquereur_id" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"termine_le" timestamp with time zone,
	CONSTRAINT "actions_type_check" CHECK ("actions"."type" IN ('appel','email','message','document','relance','autre')),
	CONSTRAINT "actions_statut_check" CHECK ("actions"."statut" IN ('a_faire','termine')),
	CONSTRAINT "actions_priorite_check" CHECK ("actions"."priorite" IN ('haute','normale','basse'))
);
