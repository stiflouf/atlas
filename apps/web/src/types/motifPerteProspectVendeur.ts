// Vocabulaire dédié (ADR-027) — pas une réutilisation de MotifPerte (types/motifPerte.ts), pensé
// pour une transaction acquéreur déjà engagée (financement refusé, acquéreur se retire...),
// inadapté à une perte en phase de prospection vendeur. Toujours choisi explicitement par le
// conseiller au moment de marquerProspectVendeurPerdu, jamais déduit d'un texte libre.
export const MOTIFS_PERTE_PROSPECT_VENDEUR = [
  "projet_abandonne",
  "choix_agence_concurrente",
  "desaccord_estimation",
  "injoignable",
  "bien_vendu_autrement",
  "delai_calendrier",
  "autre",
] as const;

export type MotifPerteProspectVendeur = (typeof MOTIFS_PERTE_PROSPECT_VENDEUR)[number];

export const LABEL_MOTIF_PERTE_PROSPECT_VENDEUR: Record<MotifPerteProspectVendeur, string> = {
  projet_abandonne: "Projet de vente abandonné",
  choix_agence_concurrente: "A choisi une agence concurrente",
  desaccord_estimation: "Désaccord sur l'estimation",
  injoignable: "Injoignable",
  bien_vendu_autrement: "Bien vendu par un autre moyen",
  delai_calendrier: "Délai ou calendrier",
  autre: "Autre",
};
