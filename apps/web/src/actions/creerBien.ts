"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { creerBien } from "@/lib/bienRepository";
import { parseBienFormData } from "@/lib/bienFormulaire";
import { resoudreCommuneBien } from "@/lib/geocodage/resolutionBien";
import { enqueuerResynchronisationBien } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// Résolution IGN best-effort (ADR-035) : jamais bloquante — une panne/ambiguïté produit
// codeInseeCommune undefined, le bien est tout de même créé.
//
// Création + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) : un bien tout juste
// créé peut déjà être compatible avec des acquéreurs existants, une vraie opportunité (pas une
// baseline) — voir l'addendum de l'audit, §5. Le traitement immédiat après commit n'est qu'une
// optimisation de délai ; la fiabilité vient de la ligne déjà durablement écrite avant lui.
export async function creerBienAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  // ADR-054 — appartenance explicite : la garde ci-dessus répond "qui entre" (IDENTITY), celle-ci
  // "dans quel périmètre on écrit" (OWNERSHIP). Jamais la même question, jamais la même source.
  const workspaceId = await exigerWorkspaceCourant();
  const donnees = parseBienFormData(formData);
  const commune = await resoudreCommuneBien(donnees.adresse, donnees.ville, donnees.codePostal);

  const { bien, idDemandeResynchronisation } = await getDb().transaction(async (tx) => {
    const bien = await creerBien({ ...donnees, codeInseeCommune: commune?.citycode }, workspaceId, tx);
    const idDemandeResynchronisation = await enqueuerResynchronisationBien(bien.id, workspaceId, tx);
    return { bien, idDemandeResynchronisation };
  });

  await traiterDemandeResynchronisation(idDemandeResynchronisation);
  redirect(`/biens/${bien.id}`);
}
