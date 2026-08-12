// Ligne de liaison explicite entre une offre et un compte rendu de visite (ADR-019) — jamais
// déduite par proximité de date, toujours créée par un geste explicite du conseiller.
export type OffreVisite = {
  id: string;
  offreId: string;
  compteRenduVisiteId: string;
  creeLe: string;
};
