"use server";

import { redirect } from "next/navigation";
import { creerBien } from "@/lib/bienRepository";
import { parseBienFormData } from "@/lib/bienFormulaire";

export async function creerBienAction(formData: FormData): Promise<void> {
  const bien = await creerBien(parseBienFormData(formData));
  redirect(`/biens/${bien.id}`);
}
