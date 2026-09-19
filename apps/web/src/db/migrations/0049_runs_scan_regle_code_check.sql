-- AUTOMATION_ENGINE_GENERALIZATION_V1 (suite de 0047) — le journal du scanner temporel doit
-- également accepter les 3 nouvelles règles temporelles : sans cette ligne, demarrerRunScanAutomatisation
-- échouerait au premier scan réel pour elles. Additif, même discipline que 0047.
ALTER TABLE "runs_scan_automatisation" DROP CONSTRAINT "runs_scan_automatisation_regle_code_check";--> statement-breakpoint
ALTER TABLE "runs_scan_automatisation" ADD CONSTRAINT "runs_scan_automatisation_regle_code_check" CHECK ("runs_scan_automatisation"."regle_code" IN (
        'suivi_apres_visite','suivi_apres_rdv_estimation',
        'preparation_apres_mandat','preparation_dossier_notaire_apres_compromis',
        'inactivite_prospect_vendeur',
        'mandat_expire_bientot','offre_sans_decision','offre_acceptee_sans_compromis'
      ));