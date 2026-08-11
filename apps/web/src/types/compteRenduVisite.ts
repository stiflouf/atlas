export type Interet = "interesse" | "a_reflechir" | "pas_interesse" | "inconnu";

export const LABEL_INTERET: Record<Interet, string> = {
  interesse: "Intéressé",
  a_reflechir: "À réfléchir",
  pas_interesse: "Pas intéressé",
  inconnu: "Intérêt non précisé",
};

export type CompteRenduVisite = {
  id: string;
  bienId: string;
  acquereurId: string;
  dateVisite: string;
  retour: string;
  interet: Interet;
  prochaineEtape?: string;
  creeLe: string;
};
