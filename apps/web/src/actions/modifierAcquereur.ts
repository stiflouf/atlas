"use server";

import { notFound, redirect } from "next/navigation";
import { modifierAcquereur } from "@/lib/clientRepository";
import { parseAcquereurFormData } from "@/lib/acquereurFormulaire";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès après une
// modification qui n'a en réalité touché aucune ligne.
export async function modifierAcquereurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const acquereur = await modifierAcquereur(id, parseAcquereurFormData(formData));
  if (!acquereur) notFound();

  redirect(`/clients/${acquereur.id}`);
}
