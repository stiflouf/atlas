-- ADR-060 — MANDATE_LIFECYCLE_FOUNDATION_V1. Migration STRICTEMENT ADDITIVE : quatre colonnes
-- nullables SANS DEFAULT (un default inventerait une nature contractuelle, un numéro ou une borne
-- d'exclusivité que personne n'a constatés sur les mandats antérieurs), deux CHECK, trois index FK.
-- AUCUN BACKFILL, aucune colonne retirée, aucun NOT NULL nouveau, aucun `workspace_id` (feuille de
-- `biens`, ADR-054 §7), aucun statut stocké (invariant 9), aucune table `parties_mandat` (lot 2).
ALTER TABLE "mandats" ADD COLUMN "type" text;--> statement-breakpoint
ALTER TABLE "mandats" ADD COLUMN "numero" text;--> statement-breakpoint
ALTER TABLE "mandats" ADD COLUMN "exclusivite_jusqu_au" date;--> statement-breakpoint
ALTER TABLE "mandats" ADD COLUMN "motif_resiliation" text;--> statement-breakpoint
CREATE INDEX "mandats_bien_idx" ON "mandats" USING btree ("bien_id");--> statement-breakpoint
CREATE INDEX "mandats_projet_vendeur_idx" ON "mandats" USING btree ("projet_vendeur_id");--> statement-breakpoint
CREATE INDEX "mandats_remplace_idx" ON "mandats" USING btree ("remplace_mandat_id");--> statement-breakpoint
ALTER TABLE "mandats" ADD CONSTRAINT "mandats_type_check" CHECK ("mandats"."type" IS NULL OR "mandats"."type" IN ('simple','exclusif','semi_exclusif'));--> statement-breakpoint
ALTER TABLE "mandats" ADD CONSTRAINT "mandats_exclusivite_coherente_check" CHECK ("mandats"."exclusivite_jusqu_au" IS NULL OR ("mandats"."exclusivite_jusqu_au" >= "mandats"."date_debut" AND ("mandats"."date_fin" IS NULL OR "mandats"."exclusivite_jusqu_au" <= "mandats"."date_fin")));