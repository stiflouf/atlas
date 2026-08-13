"use server";

import { redirect } from "next/navigation";
import { annulerTache } from "@/lib/tacheRepository";

export async function annulerTacheAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    throw new Error("Identifiant de tâche manquant.");
  }

  await annulerTache(id);

  const redirectTo = String(formData.get("redirectTo") ?? "/");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
