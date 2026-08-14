"use server";

import { redirect } from "next/navigation";
import { creerBien } from "@/lib/bienRepository";
import { parseBienFormData } from "@/lib/bienFormulaire";
import { resoudreCommuneBien } from "@/lib/geocodage/resolutionBien";

// Résolution IGN best-effort (ADR-035) : jamais bloquante — une panne/ambiguïté produit
// codeInseeCommune undefined, le bien est tout de même créé.
export async function creerBienAction(formData: FormData): Promise<void> {
  const donnees = parseBienFormData(formData);
  const commune = await resoudreCommuneBien(donnees.adresse, donnees.ville, donnees.codePostal);
  const bien = await creerBien({ ...donnees, codeInseeCommune: commune?.citycode });
  redirect(`/biens/${bien.id}`);
}
