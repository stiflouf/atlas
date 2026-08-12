import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";

// Nom distinct de StatutDossier (data/dossier.ts, mock) malgré les mêmes valeurs littérales —
// même précédent que DocumentBien/DocumentDossier, pour ne jamais confondre les deux sources.
// "vendu" n'a aucun équivalent dans le mock (StatutDossier s'arrête à compromis_signe) — état
// ajouté uniquement côté réel, ADR-017.
export type StatutCommercial = "en_commercialisation" | "offre_en_cours" | "compromis_signe" | "vendu";

export const LABEL_STATUT_COMMERCIAL: Record<StatutCommercial, string> = {
  en_commercialisation: "En commercialisation",
  offre_en_cours: "Offre en cours",
  compromis_signe: "Compromis signé",
  vendu: "Vendu",
};

// Dérivé des timestamps de jalons du bien (ADR-014) et de la liste de ses compromis (ADR-017) —
// aucun statut stocké. Priorité : vendu > compromis_signe > offre_en_cours > en_commercialisation.
// "vendu" exige un compromis 'realise' ET une dateActeReelle — un compromis 'realise' sans date
// réelle (cas normalement impossible via l'action, garde défensive ici) ne fait jamais basculer
// vers "vendu".
export function deriverStatutCommercial(bien: Bien, compromisListe: Compromis[] = []): StatutCommercial {
  if (compromisListe.some((c) => c.statut === "realise" && c.dateActeReelle)) return "vendu";
  if (bien.compromisSigneLe) return "compromis_signe";
  if (bien.offreEnCoursLe) return "offre_en_cours";
  return "en_commercialisation";
}
