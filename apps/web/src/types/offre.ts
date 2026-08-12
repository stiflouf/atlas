import type { MotifPerte } from "@/types/motifPerte";

export type StatutOffre = "en_cours" | "acceptee" | "refusee" | "retiree";

export const LABEL_STATUT_OFFRE: Record<StatutOffre, string> = {
  en_cours: "En cours",
  acceptee: "Acceptée",
  refusee: "Refusée",
  retiree: "Retirée",
};

// montant/acquereurId/bienId/dateOffre immuables après création (ADR-015) — une nouvelle
// proposition = une nouvelle offre. Seul statut est mutable (en_cours -> une valeur finale).
// dateDecision/motifPerte (ADR-020) : posés atomiquement avec statut lors de la transition finale
// (acceptee/refusee/retiree) — motifPerte reste undefined pour acceptee, obligatoire pour
// refusee/retiree (voir TransitionFinaleOffre, src/lib/offreRepository.ts).
export type Offre = {
  id: string;
  bienId: string;
  acquereurId: string;
  montant: number;
  dateOffre: string;
  statut: StatutOffre;
  dateValidite?: string;
  dateDecision?: string;
  motifPerte?: MotifPerte;
  creeLe: string;
};
