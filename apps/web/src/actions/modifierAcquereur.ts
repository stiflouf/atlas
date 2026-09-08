"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { modifierAcquereur } from "@/lib/clientRepository";
import { parseAcquereurFormData } from "@/lib/acquereurFormulaire";
import { enqueuerResynchronisationAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès après une
// modification qui n'a en réalité touché aucune ligne.
//
// Modification + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) — voir
// modifierBienAction pour le raisonnement symétrique complet.
export async function modifierAcquereurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  // ADR-054 — appartenance explicite de la demande de resynchronisation (table racine).
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const resultat = await getDb().transaction(async (tx) => {
    const acquereur = await modifierAcquereur(id, parseAcquereurFormData(formData), tx);
    if (!acquereur) return undefined;
    const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, workspaceId, tx);
    return { acquereur, idDemandeResynchronisation };
  });
  if (!resultat) notFound();

  await traiterDemandeResynchronisation(resultat.idDemandeResynchronisation);
  redirect(`/clients/${resultat.acquereur.id}`);
}
