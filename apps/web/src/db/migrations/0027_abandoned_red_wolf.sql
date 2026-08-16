ALTER TABLE "configurations_automatisation" DROP CONSTRAINT "configurations_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "envois_email" DROP CONSTRAINT "envois_email_origine_intention_check";--> statement-breakpoint
ALTER TABLE "executions_automatisation" DROP CONSTRAINT "executions_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_regle_code_check" CHECK ("configurations_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur',
        'retour_vendeur_apres_visite'
      ));--> statement-breakpoint
ALTER TABLE "envois_email" ADD CONSTRAINT "envois_email_origine_intention_check" CHECK ("envois_email"."origine_intention" IS NULL OR "envois_email"."origine_intention" IN (
        'relance_prospect_vendeur','suivi_rdv_estimation','suivi_acquereur','suivi_visite',
        'demande_document_manquant','relance_piece_a_verifier','message_compromis','message_notaire',
        'retour_vendeur_apres_visite'
      ));--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_regle_code_check" CHECK ("executions_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur',
        'retour_vendeur_apres_visite'
      ));--> statement-breakpoint
-- Seed de la 7e règle V1 (ADR-042), inactive par défaut (même convention que les règles
-- précédentes) : aucune tâche rétroactive tant qu'un geste explicite d'activation n'a pas eu lieu
-- depuis /automatisations.
INSERT INTO "configurations_automatisation" ("regle_code", "active") VALUES
  ('retour_vendeur_apres_visite', false);