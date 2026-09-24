"use server";

import { redirect } from "next/navigation";
import { annulerTache } from "@/lib/tacheRepository";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// WORKSPACE_SCOPING_V1 (ADR-054) — le périmètre est dans le `WHERE` de l'UPDATE : une tâche d'un
// autre workspace n'est pas annulée, silencieusement et sans distinction d'une tâche déjà close.
export async function annulerTacheAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) {
    throw new Error("Identifiant de tâche manquant.");
  }

  await annulerTache(id, workspaceId);

  const redirectTo = String(formData.get("redirectTo") ?? "/");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
