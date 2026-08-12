export type StatutOffre = "en_cours" | "acceptee" | "refusee" | "retiree";

export const LABEL_STATUT_OFFRE: Record<StatutOffre, string> = {
  en_cours: "En cours",
  acceptee: "Acceptée",
  refusee: "Refusée",
  retiree: "Retirée",
};

// montant/acquereurId/bienId/dateOffre immuables après création (ADR-015) — une nouvelle
// proposition = une nouvelle offre. Seul statut est mutable (en_cours -> une valeur finale).
export type Offre = {
  id: string;
  bienId: string;
  acquereurId: string;
  montant: number;
  dateOffre: string;
  statut: StatutOffre;
  dateValidite?: string;
  creeLe: string;
};
