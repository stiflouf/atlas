-- ADR-023 : amorçage du référentiel légal pour l'agent commercial immobilier indépendant (micro-BNC
-- régime général, hors Cipav), valeurs 2026 telles qu'établies lors de l'audit fiscal préalable à
-- ADR-023. categorie_activite = 'agent_commercial_immobilier' pour toutes les lignes (V1 ne cible
-- qu'une seule nature d'activité, voir profil_fiscal.natureActivite).
--
-- Convention temporelle : [date_debut_validite, date_fin_validite[ (fin exclue). Valeurs en entiers
-- exacts : centimes pour un montant, points_base pour un taux (1 % = 100 points de base).
--
-- statut_verification distingue ce qui a été lu directement dans le texte officiel
-- ('verifie_direct') de ce qui repose sur un recoupement de sources secondaires convergentes
-- ('recoupement') ou reste incertain ('a_confirmer') — voir schema.ts pour le contrat d'usage. Le
-- barème ACRE n'est volontairement pas seedé ici : aucune valeur n'a été vérifiée pendant l'audit,
-- mieux vaut une absence de règle (résolue explicitement comme "inconnue") qu'un chiffre inventé.

-- Plafond micro-BNC (art. 102 ter CGI), revalorisation triennale 2026-2028 : 83 600 €.
INSERT INTO "regle_fiscale"
  ("code", "categorie_activite", "valeur", "unite", "date_debut_validite", "date_fin_validite",
   "source_libelle", "source_url", "date_publication_source", "statut_verification")
VALUES
  ('plafond_micro_bnc', 'agent_commercial_immobilier', 8360000, 'centimes', '2026-01-01', '2029-01-01',
   'Régime déclaratif spécial (micro-BNC), champ d''application',
   'https://bofip.impots.gouv.fr/bofip/4807-PGP.html/identifiant=BOI-BNC-DECLA-20-10-20190102',
   NULL, 'recoupement')
ON CONFLICT DO NOTHING;

-- Franchise en base de TVA, prestations de services / professions libérales : seuil de base et
-- seuil majoré. Seule paire vérifiée directement (fetch BOFiP effectué pendant l'audit).
INSERT INTO "regle_fiscale"
  ("code", "categorie_activite", "valeur", "unite", "date_debut_validite", "date_fin_validite",
   "source_libelle", "source_url", "date_publication_source", "statut_verification")
VALUES
  ('seuil_tva_base', 'agent_commercial_immobilier', 3750000, 'centimes', '2026-01-01', NULL,
   'Franchise en base de TVA, champ d''application et limites',
   'https://bofip.impots.gouv.fr/bofip/849-PGP.html/identifiant=BOI-TVA-DECLA-40-10-10-20260701',
   '2026-07-01', 'verifie_direct'),
  ('seuil_tva_majore', 'agent_commercial_immobilier', 4125000, 'centimes', '2026-01-01', NULL,
   'Franchise en base de TVA, champ d''application et limites',
   'https://bofip.impots.gouv.fr/bofip/849-PGP.html/identifiant=BOI-TVA-DECLA-40-10-10-20260701',
   '2026-07-01', 'verifie_direct')
ON CONFLICT DO NOTHING;

-- Taux de cotisations sociales micro-entrepreneur, activité libérale relevant du régime général
-- (hors Cipav) : 25,6 %.
INSERT INTO "regle_fiscale"
  ("code", "categorie_activite", "valeur", "unite", "date_debut_validite", "date_fin_validite",
   "source_libelle", "source_url", "date_publication_source", "statut_verification")
VALUES
  ('taux_cotisations_bnc_general', 'agent_commercial_immobilier', 2560, 'points_base', '2026-01-01', NULL,
   'L''essentiel du statut de micro-entrepreneur, taux de cotisations par activité',
   'https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/lessentiel-du-statut.html',
   NULL, 'recoupement')
ON CONFLICT DO NOTHING;

-- Contribution à la formation professionnelle (CFP), profession libérale non réglementée.
-- Sources secondaires divergentes pendant l'audit (0,1 / 0,2 / 0,25 %) — retenu à 0,2 % (rattachement
-- FIFPL) mais marqué 'a_confirmer' : à revérifier sur autoentrepreneur.urssaf.fr avant tout calcul
-- présenté comme officiel (ADR-024).
INSERT INTO "regle_fiscale"
  ("code", "categorie_activite", "valeur", "unite", "date_debut_validite", "date_fin_validite",
   "source_libelle", "source_url", "date_publication_source", "statut_verification")
VALUES
  ('taux_cfp_liberal_non_reglemente', 'agent_commercial_immobilier', 20, 'points_base', '2026-01-01', NULL,
   'Contribution à la formation professionnelle (CFP), profession libérale non réglementée — valeur non confirmée directement, divergence entre sources secondaires',
   'https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/lessentiel-du-statut.html',
   NULL, 'a_confirmer')
ON CONFLICT DO NOTHING;

-- Abattement forfaitaire micro-BNC (34 %) et plancher (305 €).
INSERT INTO "regle_fiscale"
  ("code", "categorie_activite", "valeur", "unite", "date_debut_validite", "date_fin_validite",
   "source_libelle", "source_url", "date_publication_source", "statut_verification")
VALUES
  ('abattement_micro_bnc', 'agent_commercial_immobilier', 3400, 'points_base', '2026-01-01', NULL,
   'Déclaration des revenus de micro-entrepreneur, abattement forfaitaire micro-BNC',
   'https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-revenus-provenant-de-mon-activite-dauto-entrepreneur',
   NULL, 'recoupement'),
  ('abattement_micro_bnc_minimum', 'agent_commercial_immobilier', 30500, 'centimes', '2026-01-01', NULL,
   'Déclaration des revenus de micro-entrepreneur, plancher de l''abattement forfaitaire micro-BNC',
   'https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-revenus-provenant-de-mon-activite-dauto-entrepreneur',
   NULL, 'recoupement')
ON CONFLICT DO NOTHING;

-- Versement libératoire de l'impôt sur le revenu, activité BNC : taux 2,2 % et seuil de RFR
-- d'éligibilité par part (RFR N-2 = 2024 pour une application en 2026). Le seuil RFR n'a pas de
-- page BOFiP précise retrouvée pendant l'audit — statut 'a_confirmer', à fiabiliser avant ADR-024.
INSERT INTO "regle_fiscale"
  ("code", "categorie_activite", "valeur", "unite", "date_debut_validite", "date_fin_validite",
   "source_libelle", "source_url", "date_publication_source", "statut_verification")
VALUES
  ('taux_versement_liberatoire_bnc', 'agent_commercial_immobilier', 220, 'points_base', '2026-01-01', NULL,
   'Versement libératoire de l''impôt sur le revenu, taux par catégorie d''activité',
   'https://www.autoentrepreneur.urssaf.fr/portail/accueil/sinformer-sur-le-statut/lessentiel-du-statut.html',
   NULL, 'recoupement'),
  ('seuil_rfr_versement_liberatoire_par_part', 'agent_commercial_immobilier', 2931500, 'centimes', '2026-01-01', '2027-01-01',
   'Versement libératoire, condition de revenu fiscal de référence par part (RFR 2024 pour application 2026) — page précise non retrouvée pendant l''audit',
   'https://www.impots.gouv.fr/particulier/questions/comment-declarer-les-revenus-provenant-de-mon-activite-dauto-entrepreneur',
   NULL, 'a_confirmer')
ON CONFLICT DO NOTHING;
