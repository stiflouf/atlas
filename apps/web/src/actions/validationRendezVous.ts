"use server";

import { getRendezVousAvecContexte } from "@/lib/rendezVousContexte";
import { enregistrerDecisionHumaine, type DecisionValidation } from "@/lib/contexteRepository";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { getBienDuWorkspace } from "@/lib/bienRepository";

// Appelée directement depuis ConfirmationBienRdv (client component). Une correction humaine a
// toujours priorité sur le moteur déterministe (ADR-006) : au prochain chargement, cette
// décision sera utilisée avant toute règle automatique.
//
// WORKSPACE_SCOPING_V2D1 (ADR-054) — cette action n'avait que la garde d'authentification : elle
// répondait « qui est entré », jamais « dans quel périmètre ». `bienId` arrive du navigateur et
// était écrit TEL QUEL. Deux corrections ici :
//
//   1. le périmètre est résolu et porté jusqu'à l'écriture, qui est désormais clée sur le triplet
//      (migration 0055) — une décision de A ne peut plus écraser celle de B ;
//   2. `bienId` est REPROUVÉ dans ce périmètre. Un bien d'un autre workspace est traité exactement
//      comme un id inexistant : la décision est abandonnée en silence, rien n'est écrit, et aucun
//      message ne distingue « ailleurs » de « nulle part » — la fonction ne retourne de toute façon
//      rien (contrat inchangé, même patron que le rendez-vous introuvable ci-dessous).
//
// `decision === "ignore"` n'emporte aucun bien (bienRetenu devient null côté repository) : il n'y a
// alors rien à prouver, et refuser ce cas empêcherait d'ignorer un rendez-vous mal rapproché.
export async function enregistrerValidationBien(
  rendezVousId: string,
  decision: DecisionValidation,
  bienId: string | null
): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const resultat = await getRendezVousAvecContexte(rendezVousId, workspaceId);
  if (!resultat) return; // rendez-vous introuvable (supprimé côté Google entre-temps, etc.)

  if (bienId && decision !== "ignore" && !(await getBienDuWorkspace(bienId, workspaceId))) return;

  await enregistrerDecisionHumaine(resultat.rdv, resultat.contexte, decision, bienId, workspaceId);
}
