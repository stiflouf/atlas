"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { modifierBien } from "@/lib/bienRepository";
import { parseBienFormData } from "@/lib/bienFormulaire";
import { resoudreCommuneBien } from "@/lib/geocodage/resolutionBien";
import { enqueuerResynchronisationBien } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès après une
// modification qui n'a en réalité touché aucune ligne.
//
// La résolution IGN est TOUJOURS refaite en entier ici, jamais conditionnée à "l'adresse a-t-elle
// changé" (ADR-035, section 6) : la façon la plus sûre d'éviter un codeInseeCommune périmé après
// une modification d'adresse est de ne jamais essayer de détecter un changement — recalculer à
// chaque édition, et laisser modifierBien() écraser explicitement l'ancienne valeur (y compris par
// NULL en cas d'échec) plutôt que de risquer un bug de détection qui laisserait une ancienne
// valeur en place.
//
// Modification + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) — voir
// creerBienAction pour le raisonnement complet (handoff durable, addendum de l'audit §6).
export async function modifierBienAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const donnees = parseBienFormData(formData);
  const commune = await resoudreCommuneBien(donnees.adresse, donnees.ville, donnees.codePostal);

  const resultat = await getDb().transaction(async (tx) => {
    const bien = await modifierBien(id, { ...donnees, codeInseeCommune: commune?.citycode }, tx);
    if (!bien) return undefined;
    const idDemandeResynchronisation = await enqueuerResynchronisationBien(bien.id, tx);
    return { bien, idDemandeResynchronisation };
  });
  if (!resultat) notFound();

  await traiterDemandeResynchronisation(resultat.idDemandeResynchronisation);
  redirect(`/biens/${resultat.bien.id}`);
}
