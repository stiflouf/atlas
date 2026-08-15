ALTER TABLE "configurations_automatisation" DROP CONSTRAINT "configurations_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "executions_automatisation" DROP CONSTRAINT "executions_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_regle_code_check" CHECK ("configurations_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur'
      ));--> statement-breakpoint
ALTER TABLE "executions_automatisation" ADD CONSTRAINT "executions_automatisation_regle_code_check" CHECK ("executions_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur','nouveau_match_bien_acquereur'
      ));--> statement-breakpoint
-- Seed de la 6e règle V1 (ADR-037), inactive par défaut (même convention que les règles
-- précédentes) : aucune tâche rétroactive tant qu'un geste explicite d'activation n'a pas eu lieu
-- depuis /automatisations.
INSERT INTO "configurations_automatisation" ("regle_code", "active") VALUES
  ('nouveau_match_bien_acquereur', false);