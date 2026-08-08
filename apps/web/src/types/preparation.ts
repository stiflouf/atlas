import type { Bien } from "./bien";
import type { ProfilAcquereur } from "./client";

export type Objection = {
  objection: string;
  reponse: string;
};

export type ContexteQuartier = {
  description: string;
  transports: string[];
  commerces: string[];
  ecoles: string[];
  pointsAttention: string[];
};

export type Comparable = {
  adresse: string;
  surface: number;
  prix: number;
  prixM2: number;
  dateVente: string;
};

export type AnalyseMarche = {
  prixMoyenM2: number;
  tendance: string;
  ecartAvecMarche: string;
  comparables: Comparable[];
};

// Structure typée pour correspondre exactement à ce que l'IA retournera.
// En Sprint 1 les données sont mockées ; aucun changement UI ne sera nécessaire
// quand on branchera la vraie IA.
export type PreparationVisite = {
  id: string;
  bien: Bien;
  acquereur: ProfilAcquereur;
  dateVisite: string;
  heureVisite: string;
  resumeBien: string;
  pointsForts: string[];
  vigilances: string[];
  questionsASuggerer: string[];
  objectionsProbables: Objection[];
  contextQuartier: ContexteQuartier;
  analyseMarche: AnalyseMarche;
  // Éléments de contexte humain (histoire, anecdotes, patrimoine, évolution du secteur)
  // que le conseiller peut mobiliser si l'échange s'y prête — jamais une trame à réciter.
  contexteHumain?: string[];
};
