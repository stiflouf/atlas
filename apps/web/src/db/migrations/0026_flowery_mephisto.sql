CREATE TABLE "visites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bien_id" uuid NOT NULL,
	"acquereur_id" uuid NOT NULL,
	"date_prevue" date NOT NULL,
	"statut" text DEFAULT 'planifiee' NOT NULL,
	"rendez_vous_calendar_id" text NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visites_rendez_vous_calendar_id_unique" UNIQUE("rendez_vous_calendar_id"),
	CONSTRAINT "visites_statut_check" CHECK ("visites"."statut" IN ('planifiee','realisee','annulee'))
);
--> statement-breakpoint
ALTER TABLE "comptes_rendus_visite" ADD COLUMN "visite_id" uuid;--> statement-breakpoint
ALTER TABLE "visites" ADD CONSTRAINT "visites_bien_id_biens_id_fk" FOREIGN KEY ("bien_id") REFERENCES "public"."biens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visites" ADD CONSTRAINT "visites_acquereur_id_acquereurs_id_fk" FOREIGN KEY ("acquereur_id") REFERENCES "public"."acquereurs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comptes_rendus_visite" ADD CONSTRAINT "comptes_rendus_visite_visite_id_visites_id_fk" FOREIGN KEY ("visite_id") REFERENCES "public"."visites"("id") ON DELETE set null ON UPDATE no action;