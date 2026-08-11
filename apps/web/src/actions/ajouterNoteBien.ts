"use server";

import { redirect } from "next/navigation";
import { ajouterNoteBien } from "@/lib/noteBienRepository";

// Refus simple, sans insertion, si le contenu est vide après trim — pas d'erreur bloquante pour
// un cas aussi bénin qu'un textarea soumis vide.
export async function ajouterNoteBienAction(formData: FormData): Promise<void> {
  const bienId = String(formData.get("bienId") ?? "");
  const contenu = String(formData.get("contenu") ?? "").trim();

  if (bienId && contenu) {
    await ajouterNoteBien(bienId, contenu);
  }

  redirect(`/biens/${bienId}`);
}
