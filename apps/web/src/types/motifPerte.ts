// Vocabulaire V1 des motifs de perte commerciale (ADR-020) — partagé entre offres (refusee,
// retiree) et compromis (annule). Toujours choisi explicitement par le conseiller dans un menu
// fermé au moment de la transition, jamais déduit d'un texte libre ni d'un acteur implicite (une
// offre "retiree" ne dit pas qui a pris l'initiative — seul le motif choisi fait foi).
export const MOTIFS_PERTE = [
  "financement_refuse",
  "acquereur_se_retire",
  "vendeur_se_retire",
  "desaccord_prix",
  "juridique_administratif",
  "delai_calendrier",
  "autre",
] as const;

export type MotifPerte = (typeof MOTIFS_PERTE)[number];

export const LABEL_MOTIF_PERTE: Record<MotifPerte, string> = {
  financement_refuse: "Financement refusé",
  acquereur_se_retire: "L'acquéreur se retire",
  vendeur_se_retire: "Le vendeur se retire",
  desaccord_prix: "Désaccord sur le prix",
  juridique_administratif: "Problème juridique ou administratif",
  delai_calendrier: "Délai ou calendrier",
  autre: "Autre",
};
