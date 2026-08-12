"use server";

import { redirect } from "next/navigation";
import { creerAction } from "@/lib/actionRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import type { PrioriteAction, TypeActionMetier } from "@/types/action";

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Validation serveur minimale : incohérences évidentes uniquement, pas de règle métier avancée.
// bien/acquéreur archivé -> refus explicite (ADR-012) : contrairement à ajouterNoteBienAction/
// enregistrerCompteRenduVisiteAction (refus silencieux), ce fichier lève déjà une erreur pour le
// titre manquant — on garde le même style plutôt que d'en introduire un second dans ce fichier.
export async function creerActionAction(formData: FormData): Promise<void> {
  const titre = String(formData.get("titre") ?? "").trim();
  if (!titre) {
    throw new Error("Titre requis.");
  }

  const bienId = parseTexteOptionnel(formData.get("bienId"));
  const acquereurId = parseTexteOptionnel(formData.get("acquereurId"));

  if (bienId) {
    const bien = await getBienById(bienId);
    if (!bien || bien.archiveLe) {
      throw new Error("Impossible d'ajouter une action à un bien archivé.");
    }
  }
  if (acquereurId) {
    const acquereur = await getClientById(acquereurId);
    if (!acquereur || acquereur.archiveLe) {
      throw new Error("Impossible d'ajouter une action à un acquéreur archivé.");
    }
  }

  await creerAction({
    titre,
    contexte: parseTexteOptionnel(formData.get("contexte")),
    type: String(formData.get("type")) as TypeActionMetier,
    priorite: String(formData.get("priorite")) as PrioriteAction,
    echeance: parseTexteOptionnel(formData.get("echeance")),
    bienId,
    acquereurId,
  });

  redirect("/");
}
