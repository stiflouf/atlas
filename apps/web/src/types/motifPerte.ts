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
  // ADR-061 §5 — motif SYSTÈME : posé par le moteur quand l'acceptation d'une offre refuse les
  // autres offres en cours du même bien. Jamais proposé à la saisie humaine (MOTIFS_PERTE_HUMAINS),
  // refusé par les writers si un humain le soumet.
  "autre_offre_acceptee",
] as const;

export type MotifPerte = (typeof MOTIFS_PERTE)[number];

export const MOTIF_PERTE_SYSTEME = "autre_offre_acceptee" satisfies MotifPerte;
export type MotifPerteHumain = Exclude<MotifPerte, typeof MOTIF_PERTE_SYSTEME>;
export const MOTIFS_PERTE_HUMAINS = MOTIFS_PERTE.filter((m): m is MotifPerteHumain => m !== MOTIF_PERTE_SYSTEME);

export function estMotifPerteHumain(valeur: unknown): valeur is MotifPerteHumain {
  return typeof valeur === "string" && (MOTIFS_PERTE_HUMAINS as readonly string[]).includes(valeur);
}

export const LABEL_MOTIF_PERTE: Record<MotifPerte, string> = {
  financement_refuse: "Financement refusé",
  acquereur_se_retire: "L'acquéreur se retire",
  vendeur_se_retire: "Le vendeur se retire",
  desaccord_prix: "Désaccord sur le prix",
  juridique_administratif: "Problème juridique ou administratif",
  delai_calendrier: "Délai ou calendrier",
  autre: "Autre",
  autre_offre_acceptee: "Une autre offre a été acceptée",
};
