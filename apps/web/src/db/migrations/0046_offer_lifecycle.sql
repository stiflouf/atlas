-- ADR-061 — OFFER_LIFECYCLE_FOUNDATION_V1. Migration STRICTEMENT ADDITIVE : les DROP/ADD CONSTRAINT
-- ci-dessous ne font qu'ÉLARGIR des CHECK (statut + 'caduque', motif + 'autre_offre_acceptee',
-- types d'événements Offre/Compromis, cible offre_id) — toute ligne valide avant reste valide après.
-- Colonne nullable `evenements_metier.offre_id` (FK NO ACTION, journal append-only), index
-- d'idempotence (type, offre_id), index FK sur offres. AUCUN BACKFILL : aucune offre historique
-- modifiée, aucune acceptation multiple dédoublonnée, aucun événement ancien complété, aucun
-- jalon legacy (`biens.offre_en_cours_le`) recalculé ni effacé. Aucun index unique sur
-- `statut = 'acceptee'` (différé, ADR-061 §7), aucun `workspace_id`.
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_une_seule_cible_check";--> statement-breakpoint
ALTER TABLE "offres" DROP CONSTRAINT "offres_statut_check";--> statement-breakpoint
ALTER TABLE "offres" DROP CONSTRAINT "offres_motif_perte_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "offre_id" uuid;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_offre_id_offres_id_fk" FOREIGN KEY ("offre_id") REFERENCES "public"."offres"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_offre_unique" ON "evenements_metier" USING btree ("type_evenement","offre_id") WHERE "evenements_metier"."offre_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "offres_bien_idx" ON "offres" USING btree ("bien_id");--> statement-breakpoint
CREATE INDEX "offres_acquereur_idx" ON "offres" USING btree ("acquereur_id");--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible',
        'offre_recue','offre_acceptee','offre_refusee','offre_retiree','offre_caduque',
        'compromis_realise','compromis_annule'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_une_seule_cible_check" CHECK ((
        (case when "evenements_metier"."compte_rendu_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."compromis_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."offre_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."bien_id" is not null and "evenements_metier"."acquereur_id" is not null then 1 else 0 end)
      ) = 1);--> statement-breakpoint
ALTER TABLE "offres" ADD CONSTRAINT "offres_statut_check" CHECK ("offres"."statut" IN ('en_cours','acceptee','refusee','retiree','caduque'));--> statement-breakpoint
ALTER TABLE "offres" ADD CONSTRAINT "offres_motif_perte_check" CHECK ("offres"."motif_perte" IS NULL OR "offres"."motif_perte" IN ('financement_refuse','acquereur_se_retire','vendeur_se_retire','desaccord_prix','juridique_administratif','delai_calendrier','autre','autre_offre_acceptee'));