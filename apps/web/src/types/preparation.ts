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

// Structure typée pour correspondre exactement à ce que l'IA retournera.
// En Sprint 1 les données sont mockées ; aucun changement UI ne sera nécessaire
// quand on branchera la vraie IA.
// resumeBien et les identités bien/acquereur sont toujours des faits réels. Le reste (points
// forts, vigilances, questions, objections, contexte quartier/marché/humain) est du contenu
// curaté qui n'existe pas forcément pour chaque couple bien/acquéreur : ces champs sont donc
// optionnels plutôt que remplis de valeurs vides ou inventées (voir data/preparations.ts).
export type PreparationVisite = {
  id: string;
  bien: Bien;
  acquereur: ProfilAcquereur;
  dateVisite: string;
  heureVisite: string;
  resumeBien: string;
  pointsForts?: string[];
  vigilances?: string[];
  questionsASuggerer?: string[];
  objectionsProbables?: Objection[];
  contextQuartier?: ContexteQuartier;
  contexteHumain?: string[];
};
