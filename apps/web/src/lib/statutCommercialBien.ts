import type { Bien } from "@/types/bien";

// Nom distinct de StatutDossier (data/dossier.ts, mock) malgré les mêmes valeurs littérales —
// même précédent que DocumentBien/DocumentDossier, pour ne jamais confondre les deux sources.
export type StatutCommercial = "en_commercialisation" | "offre_en_cours" | "compromis_signe";

export const LABEL_STATUT_COMMERCIAL: Record<StatutCommercial, string> = {
  en_commercialisation: "En commercialisation",
  offre_en_cours: "Offre en cours",
  compromis_signe: "Compromis signé",
};

// Dérivé uniquement des deux timestamps de jalons (ADR-014) — aucun statut stocké. compromis
// prioritaire sur offre : un compromis peut être marqué directement sans offre préalable.
export function deriverStatutCommercial(bien: Bien): StatutCommercial {
  if (bien.compromisSigneLe) return "compromis_signe";
  if (bien.offreEnCoursLe) return "offre_en_cours";
  return "en_commercialisation";
}
