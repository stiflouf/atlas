-- AUTOMATION_ENGINE_GENERALIZATION_V1 — généralisation du seuil produit (brief §4) : cette colonne
-- ne servait qu'à 'inactivite_prospect_vendeur' ; elle sert désormais à toute règle temporelle à
-- seuil (mandat_expire_bientot, offre_sans_decision, offre_acceptee_sans_compromis), chaque règle
-- portant sa PROPRE ligne (PK = regle_code) donc sans aucune ambiguïté de sens. RENOMMAGE PUR :
-- aucune valeur n'est modifiée, aucune ligne réécrite.
ALTER TABLE "configurations_automatisation" DROP CONSTRAINT "configurations_automatisation_seuil_positif_check";--> statement-breakpoint
ALTER TABLE "configurations_automatisation" RENAME COLUMN "seuil_jours_inactivite" TO "seuil_jours";--> statement-breakpoint
ALTER TABLE "configurations_automatisation" ADD CONSTRAINT "configurations_automatisation_seuil_positif_check" CHECK ("configurations_automatisation"."seuil_jours" IS NULL OR "configurations_automatisation"."seuil_jours" > 0);