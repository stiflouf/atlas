"use server";

import { redirect } from "next/navigation";
import { creerAction } from "@/lib/actionRepository";
import type { PrioriteAction, TypeActionMetier } from "@/types/action";

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Validation serveur minimale : incohérences évidentes uniquement, pas de règle métier avancée.
export async function creerActionAction(formData: FormData): Promise<void> {
  const titre = String(formData.get("titre") ?? "").trim();
  if (!titre) {
    throw new Error("Titre requis.");
  }

  await creerAction({
    titre,
    contexte: parseTexteOptionnel(formData.get("contexte")),
    type: String(formData.get("type")) as TypeActionMetier,
    priorite: String(formData.get("priorite")) as PrioriteAction,
    echeance: parseTexteOptionnel(formData.get("echeance")),
    bienId: parseTexteOptionnel(formData.get("bienId")),
    acquereurId: parseTexteOptionnel(formData.get("acquereurId")),
  });

  redirect("/");
}
