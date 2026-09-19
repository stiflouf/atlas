-- AUTOMATION_ENGINE_GENERALIZATION_V1 — Migration STRICTEMENT ADDITIVE (même discipline que 0046) :
-- les DROP/ADD CONSTRAINT ci-dessous ne font qu'ÉLARGIR des CHECK (3 nouveaux regle_code, 3 nouveaux
-- type_evenement, cible mandat_id) — toute ligne valide avant reste valide après. Colonne nullable
-- `evenements_metier.mandat_id` (FK NO ACTION, même raisonnement append-only que `offre_id`, ADR-061),
-- index d'idempotence (type_evenement, mandat_id) — réutilise l'index `_offre_unique` déjà existant
-- pour les 2 nouvelles règles ciblant une offre, aucun nouvel index nécessaire pour elles. AUCUN
-- BACKFILL. Seed des 3 nouvelles règles, inactives par défaut (même convention que 0021/0024/0027).
ALTER TABLE "configurations_automatisation" DROP CONSTRAINT "configurations_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_une_seule_cible_check";--> statement-breakpoint
ALTER TABLE "executions_automatisation" DROP CONSTRAINT "executions_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD COLUMN "mandat_id" uuid;--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_mandat_id_mandats_id_fk" FOREIGN KEY ("mandat_id") REFERENCES "public"."mandats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_mandat_unique" ON "evenements_metier" USING btree ("type_evenement","mandat_id") WHERE "evenements_metier"."mandat_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_regle_code_check" CHECK ("configurations_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur',
        'retour_vendeur_apres_visite',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible',
        'offre_recue','offre_acceptee','offre_refusee','offre_retiree','offre_caduque',
        'compromis_realise','compromis_annule',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_une_seule_cible_check" CHECK ((
        (case when "evenements_metier"."compte_rendu_visite_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."compromis_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."offre_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."mandat_id" is not null then 1 else 0 end) +
        (case when "evenements_metier"."bien_id" is not null and "evenements_metier"."acquereur_id" is not null then 1 else 0 end)
      ) = 1);--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_regle_code_check" CHECK ("executions_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur',
        'retour_vendeur_apres_visite',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis'
      ));--> statement-breakpoint
-- Seed des 3 nouvelles règles V1, inactives par défaut (même convention que les règles précédentes) :
-- seuil laissé NULL, l'activation reste refusée tant qu'un seuil valide n'a pas été renseigné
-- explicitement depuis /automatisations. `workspace_id` explicite (ADR-054, migration 0033 a retiré
-- le DEFAULT SQL) : le seul workspace existant aujourd'hui, jamais un repli implicite.
INSERT INTO "configurations_automatisation" ("regle_code", "active", "workspace_id") VALUES
  ('mandat_expire_bientot', false, 'default'),
  ('offre_sans_decision', false, 'default'),
  ('offre_acceptee_sans_compromis', false, 'default');