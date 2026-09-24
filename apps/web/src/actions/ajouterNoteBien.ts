"use server";

import { redirect } from "next/navigation";
import { ajouterNoteBien } from "@/lib/noteBienRepository";
import { getBienDuWorkspace } from "@/lib/bienRepository";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// Refus simple, sans insertion, si le contenu est vide après trim, ou si le bien n'existe plus,
// ou s'il est archivé (getBienById continue de le résoudre — voir ADR-012 — mais aucune nouvelle
// note ne doit lui être rattachée). Pas d'erreur bloquante : ces cas ne sont normalement pas
// atteignables depuis l'UI (formulaire masqué sur un bien archivé), ce garde-fou n'est là que
// pour ne jamais insérer si l'appel est contourné.
// WORKSPACE_SCOPING_V1 (ADR-054) — le bien est résolu dans le périmètre : une note ne peut pas se
// rattacher au bien d'un autre workspace. `notes_bien` est une feuille de `biens` et n'a donc, à
// juste titre, aucun `workspace_id` propre à renseigner ici.
export async function ajouterNoteBienAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const bienId = String(formData.get("bienId") ?? "");
  const contenu = String(formData.get("contenu") ?? "").trim();

  if (bienId && contenu) {
    const bien = await getBienDuWorkspace(bienId, workspaceId);
    if (bien && !bien.archiveLe) {
      await ajouterNoteBien(bienId, contenu);
    }
  }

  redirect(`/biens/${bienId}`);
}
