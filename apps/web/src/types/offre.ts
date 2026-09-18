import type { MotifPerte } from "@/types/motifPerte";

// ADR-061 §1-§2 — cycle de vie IRRÉVERSIBLE : `en_cours` → `acceptee` | `refusee` | `retiree` ;
// `acceptee` → `caduque` (clôture explicite d'une acceptation, geste humain : l'acceptation reste
// un fait, l'offre cesse d'être l'engagement actif). `refusee`, `retiree`, `caduque` sont
// terminaux ; rien ne revient à `en_cours`. Matrice tenue par `deciderOffre` (offreRepository.ts).
export type StatutOffre = "en_cours" | "acceptee" | "refusee" | "retiree" | "caduque";

export const LABEL_STATUT_OFFRE: Record<StatutOffre, string> = {
  en_cours: "En cours",
  acceptee: "Acceptée",
  refusee: "Refusée",
  retiree: "Retirée",
  caduque: "Acceptation caduque",
};

// Transitions autorisées, et rien d'autre (ADR-061 §2).
export const TRANSITIONS_OFFRE: Readonly<Record<StatutOffre, readonly StatutOffre[]>> = {
  en_cours: ["acceptee", "refusee", "retiree"],
  acceptee: ["caduque"],
  refusee: [],
  retiree: [],
  caduque: [],
};

export function transitionOffreAutorisee(depuis: StatutOffre, vers: StatutOffre): boolean {
  return TRANSITIONS_OFFRE[depuis].includes(vers);
}

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
