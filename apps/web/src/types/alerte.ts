import type { RaisonIndisponibilite } from "@/types/resultatFiscal";
import type { RaisonIndisponibiliteProjection } from "@/types/projectionFiscale";

// ADR-026. Une alerte est toujours dérivée à la lecture depuis des résultats déjà calculés
// (ADR-022→025) — jamais persistée, jamais construite par un LLM, jamais un score affiché à l'UI.
export type NiveauAlerte = "information" | "attention" | "action_requise";

export type CategorieAlerte = "donnees_incompletes" | "commercial" | "fiscal_constate" | "fiscal_projete";

// Type stable de l'alerte : la priorité et la déduplication se basent sur ce champ, jamais sur le
// texte affiché (`titre`/`explication` peuvent évoluer librement sans casser ni l'une ni l'autre).
export type TypeAlerte =
  | "profil_fiscal_absent"
  | "profil_fiscal_inconnu"
  | "regime_non_couvert"
  | "assiette_incomplete"
  | "remuneration_manquante"
  | "date_encaissement_prevue_manquante"
  | "regle_legale_absente"
  | "historique_run_rate_insuffisant"
  | "encaissement_attendu_depasse"
  | "depassement_micro_constate"
  | "deux_annees_depassement"
  | "eligibilite_vfl_non_verifiable"
  | "depassement_projete"
  | "regles_futures_hypothetiques";

export type ProvenanceAlerte =
  | { source: "raison_indisponibilite"; raison: RaisonIndisponibilite | RaisonIndisponibiliteProjection }
  | { source: "metrique_dashboard"; nom: string; valeurCentimes: number }
  | { source: "regle_composee"; regle: string };

// Ce qui a déclenché l'alerte, pour un futur lien d'action précis — tous les champs sont optionnels,
// une alerte n'en renseigne que ceux qui la concernent réellement.
export type DonneesDeclencheuses = {
  dossierFiscalId?: string;
  bienId?: string;
  compromisId?: string;
  annee?: number;
  code?: string;
};

export type AlerteCopilote = {
  id: string; // déterministe, jamais un UUID — voir construireIdAlerte (lib/alertes/id.ts)
  type: TypeAlerte;
  categorie: CategorieAlerte;
  niveau: NiveauAlerte;
  titre: string;
  explication: string;
  donneesDeclencheuses: DonneesDeclencheuses;
  provenance: ProvenanceAlerte[];
  action?: { libelle: string; href: string };
};
