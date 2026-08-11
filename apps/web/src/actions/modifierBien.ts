"use server";

import { notFound, redirect } from "next/navigation";
import { modifierBien } from "@/lib/bienRepository";
import { parseBienFormData } from "@/lib/bienFormulaire";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès après une
// modification qui n'a en réalité touché aucune ligne.
export async function modifierBienAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const bien = await modifierBien(id, parseBienFormData(formData));
  if (!bien) notFound();

  redirect(`/biens/${bien.id}`);
}
