"use server";

import { notFound, redirect } from "next/navigation";
import { modifierBien } from "@/lib/bienRepository";
import { parseBienFormData } from "@/lib/bienFormulaire";
import { resoudreCommuneBien } from "@/lib/geocodage/resolutionBien";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès après une
// modification qui n'a en réalité touché aucune ligne.
//
// La résolution IGN est TOUJOURS refaite en entier ici, jamais conditionnée à "l'adresse a-t-elle
// changé" (ADR-035, section 6) : la façon la plus sûre d'éviter un codeInseeCommune périmé après
// une modification d'adresse est de ne jamais essayer de détecter un changement — recalculer à
// chaque édition, et laisser modifierBien() écraser explicitement l'ancienne valeur (y compris par
// NULL en cas d'échec) plutôt que de risquer un bug de détection qui laisserait une ancienne
// valeur en place.
export async function modifierBienAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const donnees = parseBienFormData(formData);
  const commune = await resoudreCommuneBien(donnees.adresse, donnees.ville, donnees.codePostal);
  const bien = await modifierBien(id, { ...donnees, codeInseeCommune: commune?.citycode });
  if (!bien) notFound();

  redirect(`/biens/${bien.id}`);
}
