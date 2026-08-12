"use server";

import { notFound, redirect } from "next/navigation";
import { archiverBien, desarchiverBien } from "@/lib/bienRepository";

// id absent/invalide/inexistant -> notFound(), jamais une redirection de succès silencieuse
// (même garde que modifierBienAction).
export async function archiverBienAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const bien = await archiverBien(id);
  if (!bien) notFound();

  redirect(`/biens/${bien.id}`);
}

export async function desarchiverBienAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) notFound();

  const bien = await desarchiverBien(id);
  if (!bien) notFound();

  redirect(`/biens/${bien.id}`);
}
