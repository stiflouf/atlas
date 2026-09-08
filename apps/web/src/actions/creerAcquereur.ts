"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { creerAcquereur } from "@/lib/clientRepository";
import { parseAcquereurFormData } from "@/lib/acquereurFormulaire";
import { enqueuerResynchronisationAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// Création + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) — un acquéreur tout
// juste créé peut déjà être compatible avec des biens existants, une vraie opportunité (pas une
// baseline) — voir creerBienAction pour le raisonnement symétrique complet.
export async function creerAcquereurAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const { idDemandeResynchronisation } = await getDb().transaction(async (tx) => {
    const acquereur = await creerAcquereur(parseAcquereurFormData(formData), workspaceId, tx);
    const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereur.id, workspaceId, tx);
    return { acquereur, idDemandeResynchronisation };
  });

  await traiterDemandeResynchronisation(idDemandeResynchronisation);
  redirect("/clients");
}
