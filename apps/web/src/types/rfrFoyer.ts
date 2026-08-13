// ADR-023, point 3. nombrePartsCentiemes : entier exact, 1,5 part = 150 — jamais un flottant.
export type RfrFoyer = {
  id: string;
  dossierFiscalId: string;
  anneeRfr: number;
  rfrFoyerCentimes: number;
  nombrePartsCentiemes: number;
  creeLe: string;
  modifieLe?: string;
};
