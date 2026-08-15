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
  // Visite Atlas d'origine (ADR-040) — absent pour tout compte rendu créé avant cette ADR (jamais
  // de backfill par proximité de date, voir docs/adr/040-cycle-vie-visite.md) ou si la visite n'a
  // pas pu être matérialisée (bien/acquéreur non réels au moment de la préparation).
  visiteId?: string;
  dateVisite: string;
  retour: string;
  interet: Interet;
  prochaineEtape?: string;
  creeLe: string;
};
