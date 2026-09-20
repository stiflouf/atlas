-- VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — Migration STRICTEMENT ADDITIVE, même discipline que
-- 0046/0047 : le DROP/ADD CONSTRAINT sur "rendez_vous_calendar_id" ne fait que RELÂCHER une
-- contrainte NOT NULL et remplacer une contrainte UNIQUE globale par un index unique PARTIEL
-- (WHERE IS NOT NULL) — strictement équivalent pour toute ligne existante (toutes ont un
-- rendez_vous_calendar_id non-null aujourd'hui), sans jamais réécrire une valeur. Deux colonnes
-- timestamp nullables ajoutées (realisee_le/annulee_le), toujours NULL pour l'historique — AUCUNE
-- dérivation rétroactive depuis un champ existant (aucune base fiable pour dater rétroactivement
-- une transition déjà survenue). UNIQUE(visite_id) sur comptes_rendus_visite : durcit en base un
-- invariant déjà garanti applicativement (ADR-040/041) — aucune ligne existante ne peut y
-- contrevenir. evenements_metier.visite_id (FK NO ACTION, append-only) : nouvelle cible ponctuelle
-- pour visite_annulee uniquement, visite_realisee garde son contrat existant sur
-- compte_rendu_visite_id (ADR-041 §5, non modifié). AUCUN BACKFILL, AUCUNE suppression, AUCUNE
-- visite/compte-rendu existant modifié.
ALTER TABLE "visites" DROP CONSTRAINT "visites_rendez_vous_calendar_id_unique";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_une_seule_cible_check";--> statement-breakpoint
ALTER TABLE "visites" ALTER COLUMN "rendez_vous_calendar_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "visite_id" uuid;--> statement-breakpoint
ALTER TABLE "visites" ADD COLUMN "realisee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visites" ADD COLUMN "annulee_le" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_visite_id_visites_id_fk" FOREIGN KEY ("visite_id") REFERENCES "public"."visites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comptes_rendus_visite_visite_id_unique" ON "comptes_rendus_visite" USING btree ("visite_id") WHERE "comptes_rendus_visite"."visite_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_visite_id_unique" ON "evenements_metier" USING btree ("type_evenement","visite_id") WHERE "evenements_metier"."visite_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "visites_rendez_vous_calendar_id_unique" ON "visites" USING btree ("rendez_vous_calendar_id") WHERE "visites"."rendez_vous_calendar_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible',
        'offre_recue','offre_acceptee','offre_refusee','offre_retiree','offre_caduque',
        'compromis_realise','compromis_annule',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis',
        'visite_annulee'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_une_seule_cible_check" CHECK ((
        (case when "evenements_metier"."compte_rendu_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."compromis_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."offre_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."mandat_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."bien_id" is not null and "evenements_metier"."acquereur_id" is not null then 1 else 0 end)
      ) = 1);