"use server";

import { redirect } from "next/navigation";
import { creerAcquereur } from "@/lib/clientRepository";
import { parseAcquereurFormData } from "@/lib/acquereurFormulaire";

export async function creerAcquereurAction(formData: FormData): Promise<void> {
  await creerAcquereur(parseAcquereurFormData(formData));
  redirect("/clients");
}
