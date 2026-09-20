-- VISIT_AUTOMATION_V1 (ADR-063) — strictement additive : une colonne nullable sur `taches`
-- (visite_canonique_id, FK visites, cascade — distincte de taches.visite_id, qui référence en
-- réalité comptes_rendus_visite, nom trompeur hérité jamais renommé pour ne pas casser les tâches
-- existantes), deux nouveaux types d'événement (visite_j_1 cyclique, visite_sans_compte_rendu
-- ponctuel), un index unique partiel dédié au cycle J-1 (analogue à inactivite_prospect_vendeur,
-- ADR-033), l'index générique visite_id désormais explicitement exclu pour visite_j_1. Les
-- DROP+re-CREATE de contraintes CHECK ci-dessous ne font qu'élargir leur liste de valeurs
-- autorisées (même idiome que 0046/0047/0050/0051) — aucune table supprimée, aucune colonne
-- retirée, aucun backfill, aucune donnée existante modifiée ou réinterprétée.
ALTER TABLE "configurations_automatisation" DROP CONSTRAINT "configurations_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "evenements_metier" DROP CONSTRAINT "evenements_metier_type_check";--> statement-breakpoint
ALTER TABLE "executions_automatisation" DROP CONSTRAINT "executions_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "runs_scan_automatisation" DROP CONSTRAINT "runs_scan_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "taches" DROP CONSTRAINT "taches_une_seule_cible_check";--> statement-breakpoint
DROP INDEX "evenements_metier_visite_id_unique";--> statement-breakpoint
ALTER TABLE "taches" ADD COLUMN "visite_canonique_id" uuid;--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_visite_canonique_id_visites_id_fk" FOREIGN KEY ("visite_canonique_id") REFERENCES "public"."visites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_visite_j1_unique" ON "evenements_metier" USING btree ("type_evenement","visite_id","ancre_cycle") WHERE "evenements_metier"."type_evenement" = 'visite_j_1';--> statement-breakpoint
CREATE UNIQUE INDEX "evenements_metier_visite_id_unique" ON "evenements_metier" USING btree ("type_evenement","visite_id") WHERE "evenements_metier"."visite_id" IS NOT NULL AND "evenements_metier"."type_evenement" <> 'visite_j_1';--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_regle_code_check" CHECK ("configurations_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur',
        'retour_vendeur_apres_visite',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis',
        'visite_j_1','visite_sans_compte_rendu'
      ));--> statement-breakpoint
ALTER TABLE "evenements_metier" ADD CONSTRAINT "evenements_metier_type_check" CHECK ("evenements_metier"."type_evenement" IN (
        'visite_realisee','rdv_estimation_realise','mandat_signe','compromis_signe',
        'inactivite_prospect_vendeur','compatibilite_bien_acquereur_devenue_compatible',
        'offre_recue','offre_acceptee','offre_refusee','offre_retiree','offre_caduque',
        'compromis_realise','compromis_annule',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis',
        'visite_annulee','bon_visite_signe',
        'visite_j_1','visite_sans_compte_rendu'
      ));--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_regle_code_check" CHECK ("executions_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur',
        'retour_vendeur_apres_visite',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis',
        'visite_j_1','visite_sans_compte_rendu'
      ));--> statement-breakpoint
ALTER TABLE "runs_scan_automatisation" ADD CONSTRAINT "runs_scan_automatisation_regle_code_check" CHECK ("runs_scan_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis',
        'visite_j_1','visite_sans_compte_rendu'
      ));--> statement-breakpoint
ALTER TABLE "taches" ADD CONSTRAINT "taches_une_seule_cible_check" CHECK ((
        (case when "taches"."bien_id" is not null then 1 else 0 end) +
        (case when "taches"."acquereur_id" is not null then 1 else 0 end) +
        (case when "taches"."prospect_vendeur_id" is not null then 1 else 0 end) +
        (case when "taches"."visite_id" is not null then 1 else 0 end) +
        (case when "taches"."offre_id" is not null then 1 else 0 end) +
        (case when "taches"."compromis_id" is not null then 1 else 0 end) +
        (case when "taches"."remuneration_id" is not null then 1 else 0 end) +
        (case when "taches"."visite_canonique_id" is not null then 1 else 0 end)
      ) <= 1);
--> statement-breakpoint
-- Seed INACTIF (§17 du brief) : une nouvelle règle n'entre jamais en production silencieusement,
-- seule une activation explicite depuis /automatisations la fait réagir (même patron que 0047).
-- seuil_jours réutilisé génériquement : "combien de jours avant la date prévue" pour visite_j_1
-- (1 = J-1, la sémantique par défaut demandée), "combien de jours après la date prévue, sans CR"
-- pour visite_sans_compte_rendu (1 jour recommandé, §6).
INSERT INTO "configurations_automatisation" ("regle_code", "active", "workspace_id") VALUES
  ('visite_j_1', false, 'default'),
  ('visite_sans_compte_rendu', false, 'default');