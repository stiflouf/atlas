"use server";

import { redirect } from "next/navigation";
import { definirActivationAutomatisation } from "@/lib/automatisations/configurationAutomatisationRepository";
import { CODES_REGLE_AUTOMATISATION, type CodeRegleAutomatisation } from "@/types/automatisation";

// Bascule explicite (ADR-032, point 7) — jamais un état implicite. `active` vient d'une case à
// cocher/valeur de formulaire, jamais deviné.
export async function basculerAutomatisationAction(formData: FormData): Promise<void> {
  const regleCode = String(formData.get("regleCode") ?? "");
  if (!CODES_REGLE_AUTOMATISATION.includes(regleCode as CodeRegleAutomatisation)) {
    throw new Error("Règle inconnue.");
  }
  const active = formData.get("active") === "1";
  await definirActivationAutomatisation(regleCode as CodeRegleAutomatisation, active);
  redirect("/automatisations");
}
