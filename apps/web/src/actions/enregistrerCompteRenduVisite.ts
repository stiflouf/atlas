"use server";

import { redirect } from "next/navigation";
import { enregistrerCompteRenduVisite } from "@/lib/compteRenduVisiteRepository";
import type { Interet } from "@/types/compteRenduVisite";

const INTERETS_VALIDES: Interet[] = ["interesse", "a_reflechir", "pas_interesse", "inconnu"];

function parseInteret(valeur: FormDataEntryValue | null): Interet | undefined {
  return INTERETS_VALIDES.includes(valeur as Interet) ? (valeur as Interet) : undefined;
}

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Refus simple, sans insertion, si le retour est vide après trim ou si interet ne correspond à
// aucune des 4 valeurs contrôlées — jamais d'insertion avec une valeur hors vocabulaire.
export async function enregistrerCompteRenduVisiteAction(formData: FormData): Promise<void> {
  const bienId = String(formData.get("bienId") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const dateVisite = String(formData.get("dateVisite") ?? "");
  const retour = String(formData.get("retour") ?? "").trim();
  const interet = parseInteret(formData.get("interet"));

  if (bienId && acquereurId && dateVisite && retour && interet) {
    await enregistrerCompteRenduVisite({
      bienId,
      acquereurId,
      dateVisite,
      retour,
      interet,
      prochaineEtape: parseTexteOptionnel(formData.get("prochaineEtape")),
    });
  }

  redirect(`/biens/${bienId}`);
}
