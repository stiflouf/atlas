import { dedupliquerOpportunites } from "./deduplication";
import { trierOpportunites } from "./priorite";
import {
  regleInformationAVerifier,
  regleMatchAExploiter,
  regleRelanceProspectVendeur,
  regleSuiviVisite,
} from "./regles";
import type { ContexteOpportunites } from "./contexte";
import type { Opportunite } from "@/types/opportunite";

// VALUE-01 — moteur déterministe, même forme que produireAlertes (ADR-026) : contexte de faits
// déjà chargé -> règles pures -> déduplication (dont, ici, contre les tâches actives) -> tri
// explicable. Aucune écriture, aucune persistance, aucun LLM, aucun score affiché.
export function detecterOpportunites(
  contexte: ContexteOpportunites,
  maintenant: Date = new Date()
): Opportunite[] {
  const suivisVisite = regleSuiviVisite(contexte, maintenant);

  const brutes: Opportunite[] = [
    ...regleRelanceProspectVendeur(contexte, maintenant),
    ...suivisVisite,
    ...regleMatchAExploiter(contexte),
    ...regleInformationAVerifier(contexte),
  ];

  // Une visite concerne aussi son acquéreur : une tâche ouverte sur cet acquéreur couvre déjà le
  // suivi, même si le conseiller ne l'a pas rattachée à la visite elle-même. La correspondance est
  // fournie par le moteur, jamais devinée dans la déduplication.
  const visiteParId = new Map(contexte.visites.map((v) => [v.id, v]));
  const ciblesSecondaires = new Map<string, string>();
  for (const opportunite of suivisVisite) {
    const visite = visiteParId.get(opportunite.cible.id);
    if (visite) ciblesSecondaires.set(opportunite.id, `acquereur:${visite.acquereurId}`);
  }

  return trierOpportunites(dedupliquerOpportunites(brutes, contexte.tachesActives, ciblesSecondaires));
}
