"use server";

import { notFound, redirect } from "next/navigation";
import { archiverAcquereur, desarchiverAcquereur } from "@/lib/clientRepository";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès silencieuse
// (même garde que modifierAcquereurAction).
export async function archiverAcquereurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const acquereur = await archiverAcquereur(id);
  if (!acquereur) notFound();

  redirect(`/clients/${acquereur.id}`);
}

export async function desarchiverAcquereurAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const acquereur = await desarchiverAcquereur(id);
  if (!acquereur) notFound();

  redirect(`/clients/${acquereur.id}`);
}
