"use server";

import { redirect } from "next/navigation";
import { ajouterNoteBien } from "@/lib/noteBienRepository";
import { getBienById } from "@/lib/bienRepository";

// Refus simple, sans insertion, si le contenu est vide après trim, ou si le bien n'existe plus,
// ou s'il est archivé (getBienById continue de le résoudre — voir ADR-012 — mais aucune nouvelle
// note ne doit lui être rattachée). Pas d'erreur bloquante : ces cas ne sont normalement pas
// atteignables depuis l'UI (formulaire masqué sur un bien archivé), ce garde-fou n'est là que
// pour ne jamais insérer si l'appel est contourné.
export async function ajouterNoteBienAction(formData: FormData): Promise<void> {
  const bienId = String(formData.get("bienId") ?? "");
  const contenu = String(formData.get("contenu") ?? "").trim();

  if (bienId && contenu) {
    const bien = await getBienById(bienId);
    if (bien && !bien.archiveLe) {
      await ajouterNoteBien(bienId, contenu);
    }
  }

  redirect(`/biens/${bienId}`);
}
