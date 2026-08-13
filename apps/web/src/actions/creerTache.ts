"use server";

import { redirect } from "next/navigation";
import { creerTache } from "@/lib/tacheRepository";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { getProspectVendeurById } from "@/lib/prospectVendeurRepository";
import type { CibleTache, PrioriteTache, TypeTache } from "@/types/tache";

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Validation serveur minimale : incohérences évidentes uniquement, pas de règle métier avancée —
// même style que l'ancien creerActionAction. bien/acquéreur/prospect vendeur archivé -> refus
// explicite (ADR-012/027).
export async function creerTacheAction(formData: FormData): Promise<void> {
  const titre = String(formData.get("titre") ?? "").trim();
  if (!titre) {
    throw new Error("Titre requis.");
  }

  const bienId = parseTexteOptionnel(formData.get("bienId"));
  const acquereurId = parseTexteOptionnel(formData.get("acquereurId"));
  const prospectVendeurId = parseTexteOptionnel(formData.get("prospectVendeurId"));

  // Au plus une cible (miroir du CHECK taches_une_seule_cible_check, schema.ts) — refus explicite
  // plutôt que de choisir silencieusement laquelle garder.
  const nombreCibles = [bienId, acquereurId, prospectVendeurId].filter((v) => v !== undefined).length;
  if (nombreCibles > 1) {
    throw new Error("Une tâche ne peut être rattachée qu'à une seule cible à la fois.");
  }

  let cible: CibleTache | undefined;
  if (bienId) {
    const bien = await getBienById(bienId);
    if (!bien || bien.archiveLe) {
      throw new Error("Impossible d'ajouter une tâche à un bien archivé.");
    }
    cible = { type: "bien", id: bienId };
  } else if (acquereurId) {
    const acquereur = await getClientById(acquereurId);
    if (!acquereur || acquereur.archiveLe) {
      throw new Error("Impossible d'ajouter une tâche à un acquéreur archivé.");
    }
    cible = { type: "acquereur", id: acquereurId };
  } else if (prospectVendeurId) {
    const prospect = await getProspectVendeurById(prospectVendeurId);
    if (!prospect || prospect.archiveLe) {
      throw new Error("Impossible d'ajouter une tâche à un prospect vendeur archivé.");
    }
    cible = { type: "prospectVendeur", id: prospectVendeurId };
  }

  await creerTache({
    titre,
    contexte: parseTexteOptionnel(formData.get("contexte")),
    type: String(formData.get("type")) as TypeTache,
    priorite: String(formData.get("priorite")) as PrioriteTache,
    echeance: parseTexteOptionnel(formData.get("echeance")),
    origine: "manuelle",
    cible,
  });

  const redirectTo = String(formData.get("redirectTo") ?? "/");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
