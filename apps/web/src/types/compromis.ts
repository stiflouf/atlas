import type { MotifPerte } from "@/types/motifPerte";

export type StatutCompromis = "en_cours" | "realise" | "annule";

export const LABEL_STATUT_COMPROMIS: Record<StatutCompromis, string> = {
  en_cours: "En cours",
  realise: "Réalisé",
  annule: "Annulé",
};

// bienId/acquereurId/offreId/prixConvenu/dateSignature immuables après création (ADR-016) — une
// nouvelle signature = une nouvelle ligne. Seul statut est mutable (en_cours -> une valeur finale).
// dateActe (prévue, saisie à la création) et dateActeReelle (constatée, posée uniquement au
// passage à 'realise') sont deux champs distincts, jamais fusionnés (ADR-017) — la distinction
// est conservée pour permettre plus tard un suivi de pipeline/délais/CA prévisionnel vs réalisé.
// dateAnnulation/motifAnnulation (ADR-020) : posés atomiquement avec statut lors de la transition
// vers annule uniquement — realise continue d'utiliser exclusivement dateActeReelle, jamais ces
// deux champs.
export type Compromis = {
  id: string;
  bienId: string;
  acquereurId: string;
  offreId?: string;
  prixConvenu: number;
  dateSignature: string;
  dateActe?: string;
  dateActeReelle?: string;
  dateAnnulation?: string;
  motifAnnulation?: MotifPerte;
  statut: StatutCompromis;
  creeLe: string;
};
