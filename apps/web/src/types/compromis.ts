export type StatutCompromis = "en_cours" | "realise" | "annule";

export const LABEL_STATUT_COMPROMIS: Record<StatutCompromis, string> = {
  en_cours: "En cours",
  realise: "Réalisé",
  annule: "Annulé",
};

// bienId/acquereurId/offreId/prixConvenu/dateSignature immuables après création (ADR-016) — une
// nouvelle signature = une nouvelle ligne. Seul statut est mutable (en_cours -> une valeur finale).
export type Compromis = {
  id: string;
  bienId: string;
  acquereurId: string;
  offreId?: string;
  prixConvenu: number;
  dateSignature: string;
  dateActe?: string;
  statut: StatutCompromis;
  creeLe: string;
};
