"use server";

import { redirect } from "next/navigation";
import { terminerAction } from "@/lib/actionRepository";

export async function terminerActionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) {
    throw new Error("Identifiant d'action manquant.");
  }

  await terminerAction(id);

  const redirectTo = String(formData.get("redirectTo") ?? "/");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
