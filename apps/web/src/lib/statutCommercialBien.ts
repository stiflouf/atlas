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
//
// ADR-046 — le modèle structuré (compromisListe) est désormais PRIORITAIRE sur le jalon legacy
// bien.compromisSigneLe pour "compromis_signe", dès qu'au moins un compromis structuré existe pour
// ce bien : un compromis 'en_cours' fait toujours basculer vers "compromis_signe" (même si le
// jalon legacy a été effacé indépendamment via l'ancien mécanisme, src/actions/statutCommercialBien.ts),
// et à l'inverse, si tous les compromis structurés sont 'annule' (aucun 'en_cours' ni 'realise'),
// le jalon legacy n'est JAMAIS consulté pour "compromis_signe" — sans cette règle, une annulation
// structurée (changerStatutCompromisAction) laissait un badge "Compromis signé" fantôme, puisque
// cette transition ne touche jamais bien.compromisSigneLe (ADR-016, séparation volontaire des
// gestes commerciaux). Le jalon legacy reste un FALLBACK, utilisé uniquement en l'absence totale de
// compromis structuré pour ce bien — compatibilité des anciens dossiers antérieurs aux entités
// Offre/Compromis (ADR-014), jamais rendu faux par cette ADR.
export function deriverStatutCommercial(bien: Bien, compromisListe: Compromis[] = []): StatutCommercial {
  if (compromisListe.some((c) => c.statut === "realise" && c.dateActeReelle)) return "vendu";
  // Tout compromis structuré NON annulé (en_cours, ou un 'realise' défensif sans dateActeReelle —
  // cas normalement impossible via l'action, jamais un motif de régresser vers "aucun compromis")
  // fait basculer vers "compromis_signe", INDÉPENDAMMENT du jalon legacy. Si tous les compromis
  // structurés sont 'annule', ce test est vacuously false : le jalon legacy n'est alors JAMAIS
  // consulté pour "compromis_signe" (voir ligne suivante, réservée aux biens SANS aucun compromis
  // structuré) — sans cette règle, annuler un compromis via changerStatutCompromisAction (qui ne
  // touche jamais bien.compromisSigneLe, ADR-016) laissait un badge "Compromis signé" fantôme.
  if (compromisListe.some((c) => c.statut !== "annule")) return "compromis_signe";
  if (compromisListe.length === 0 && bien.compromisSigneLe) return "compromis_signe";
  if (bien.offreEnCoursLe) return "offre_en_cours";
  return "en_commercialisation";
}
