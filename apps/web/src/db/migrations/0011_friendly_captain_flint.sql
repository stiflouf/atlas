CREATE TABLE "offre_visites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offre_id" uuid NOT NULL,
	"compte_rendu_visite_id" uuid NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offre_visites_offre_id_compte_rendu_visite_id_unique" UNIQUE("offre_id","compte_rendu_visite_id")
);
--> statement-breakpoint
ALTER TABLE "offre_visites" ADD CONSTRAINT "offre_visites_offre_id_offres_id_fk" FOREIGN KEY ("offre_id") REFERENCES "public"."offres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offre_visites" ADD CONSTRAINT "offre_visites_compte_rendu_visite_id_comptes_rendus_visite_id_fk" FOREIGN KEY ("compte_rendu_visite_id") REFERENCES "public"."comptes_rendus_visite"("id") ON DELETE cascade ON UPDATE no action;