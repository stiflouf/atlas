"use server";

import { getRendezVousAvecContexte } from "@/lib/rendezVousContexte";
import { enregistrerDecisionHumaine, type DecisionValidation } from "@/lib/contexteRepository";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

// Appelée directement depuis ConfirmationBienRdv (client component). Une correction humaine a
// toujours priorité sur le moteur déterministe (ADR-006) : au prochain chargement, cette
// décision sera utilisée avant toute règle automatique.
export async function enregistrerValidationBien(
  rendezVousId: string,
  decision: DecisionValidation,
  bienId: string | null
): Promise<void> {
  await exigerSessionAtlas();
  const resultat = await getRendezVousAvecContexte(rendezVousId);
  if (!resultat) return; // rendez-vous introuvable (supprimé côté Google entre-temps, etc.)

  await enregistrerDecisionHumaine(resultat.rdv, resultat.contexte, decision, bienId);
}
