// ADR-023, point 2/3.
export type HistoriqueAmorcage = {
  id: string;
  dossierFiscalId: string;
  annee: number;
  montantEncaisseCentimes: number;
  dateFinCouverture: string;
  creeLe: string;
  modifieLe?: string;
};

// Contrat du futur résolveur (ADR-024) : absence de ligne pour une année = couverture antérieure
// inconnue, jamais assimilée à un CA de 0. Un montant de 0 en base (connu: true) est un zéro
// confirmé explicitement par le conseiller, distinct de cette absence — voir
// historiqueAmorcageRepository.chargerCouvertureAnnee.
export type CouvertureAnnuelle =
  | { annee: number; connu: true; montantEncaisseCentimes: number; dateFinCouverture: string }
  | { annee: number; connu: false };
