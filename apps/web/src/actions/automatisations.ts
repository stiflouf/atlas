"use server";

import { redirect } from "next/navigation";
import {
  definirActivationAutomatisation,
  definirSeuilAutomatisation,
  getConfigurationAutomatisation,
} from "@/lib/automatisations/configurationAutomatisationRepository";
import { CODES_REGLE_AUTOMATISATION, type CodeRegleAutomatisation } from "@/types/automatisation";

// Règles dont l'activation exige un paramètre produit explicite (ADR-033, point 4) — seule
// 'inactivite_prospect_vendeur' aujourd'hui. Vérifié ici (Server Action), jamais dans le
// repository (ADR-007 : la validation métier ne vit jamais dans la couche IO).
const REGLES_AVEC_SEUIL_OBLIGATOIRE: CodeRegleAutomatisation[] = ["inactivite_prospect_vendeur"];

// Bascule explicite (ADR-032, point 7) — jamais un état implicite. `active` vient d'une case à
// cocher/valeur de formulaire, jamais deviné. Refuse explicitement d'activer une règle qui exige
// un seuil tant qu'aucun seuil valide n'est configuré — jamais un repli silencieux vers une valeur
// par défaut.
export async function basculerAutomatisationAction(formData: FormData): Promise<void> {
  const regleCode = String(formData.get("regleCode") ?? "");
  if (!CODES_REGLE_AUTOMATISATION.includes(regleCode as CodeRegleAutomatisation)) {
    throw new Error("Règle inconnue.");
  }
  const active = formData.get("active") === "1";

  if (active && REGLES_AVEC_SEUIL_OBLIGATOIRE.includes(regleCode as CodeRegleAutomatisation)) {
    const configuration = await getConfigurationAutomatisation(regleCode as CodeRegleAutomatisation);
    if (configuration.seuilJoursInactivite == null) {
      throw new Error("Impossible d'activer cette règle sans seuil configuré.");
    }
  }

  await definirActivationAutomatisation(regleCode as CodeRegleAutomatisation, active);
  redirect("/automatisations");
}

// Seuil produit explicite (ADR-033, point 4) — ne touche jamais l'activation. Un nombre de jours
// entier strictement positif, refusé sinon (aucune valeur implicite, aucun repli silencieux).
export async function definirSeuilAutomatisationAction(formData: FormData): Promise<void> {
  const regleCode = String(formData.get("regleCode") ?? "");
  if (!CODES_REGLE_AUTOMATISATION.includes(regleCode as CodeRegleAutomatisation)) {
    throw new Error("Règle inconnue.");
  }
  const seuilJours = Number(formData.get("seuilJours"));
  if (!Number.isInteger(seuilJours) || seuilJours <= 0) {
    throw new Error("Le seuil doit être un nombre de jours entier strictement positif.");
  }

  await definirSeuilAutomatisation(regleCode as CodeRegleAutomatisation, seuilJours);
  redirect("/automatisations");
}
