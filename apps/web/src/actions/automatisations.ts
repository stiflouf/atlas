"use server";

import { redirect } from "next/navigation";
import {
  definirActivationAutomatisation,
  definirSeuilAutomatisation,
  getConfigurationAutomatisation,
} from "@/lib/automatisations/configurationAutomatisationRepository";
import { CODES_REGLE_AUTOMATISATION, type CodeRegleAutomatisation } from "@/types/automatisation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// Règles dont l'activation exige un paramètre produit explicite (ADR-033, point 4 ; généralisé
// AUTOMATION_ENGINE_GENERALIZATION_V1 aux 3 nouvelles règles temporelles à seuil). Vérifié ici
// (Server Action), jamais dans le repository (ADR-007 : la validation métier ne vit jamais dans la
// couche IO).
const REGLES_AVEC_SEUIL_OBLIGATOIRE: CodeRegleAutomatisation[] = [
  "inactivite_prospect_vendeur",
  "mandat_expire_bientot",
  "offre_sans_decision",
  "offre_acceptee_sans_compromis",
  "visite_j_1",
  "visite_sans_compte_rendu",
];

// Bascule explicite (ADR-032, point 7) — jamais un état implicite. `active` vient d'une case à
// cocher/valeur de formulaire, jamais deviné. Refuse explicitement d'activer une règle qui exige
// un seuil tant qu'aucun seuil valide n'est configuré — jamais un repli silencieux vers une valeur
// par défaut.
export async function basculerAutomatisationAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const regleCode = String(formData.get("regleCode") ?? "");
  if (!CODES_REGLE_AUTOMATISATION.includes(regleCode as CodeRegleAutomatisation)) {
    throw new Error("Règle inconnue.");
  }
  const active = formData.get("active") === "1";

  // WORKSPACE_SCOPING_V2B5 — résolu AVANT la garde de seuil, pas seulement avant l'écriture : la
  // garde interroge la configuration, et une lecture par `regleCode` seul aurait autorisé (ou
  // refusé) une activation ici sur la foi du seuil renseigné dans un AUTRE workspace.
  const workspaceId = await exigerWorkspaceCourant();

  if (active && REGLES_AVEC_SEUIL_OBLIGATOIRE.includes(regleCode as CodeRegleAutomatisation)) {
    const configuration = await getConfigurationAutomatisation(regleCode as CodeRegleAutomatisation, workspaceId);
    if (configuration.seuilJours == null) {
      throw new Error("Impossible d'activer cette règle sans seuil configuré.");
    }
  }

  // ADR-054 — l'activation d'une règle appartient au workspace qui la configure.
  await definirActivationAutomatisation(regleCode as CodeRegleAutomatisation, active, workspaceId);
  redirect("/automatisations");
}

// Seuil produit explicite (ADR-033, point 4) — ne touche jamais l'activation. Un nombre de jours
// entier strictement positif, refusé sinon (aucune valeur implicite, aucun repli silencieux).
export async function definirSeuilAutomatisationAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const regleCode = String(formData.get("regleCode") ?? "");
  if (!CODES_REGLE_AUTOMATISATION.includes(regleCode as CodeRegleAutomatisation)) {
    throw new Error("Règle inconnue.");
  }
  const seuilJours = Number(formData.get("seuilJours"));
  if (!Number.isInteger(seuilJours) || seuilJours <= 0) {
    throw new Error("Le seuil doit être un nombre de jours entier strictement positif.");
  }

  await definirSeuilAutomatisation(regleCode as CodeRegleAutomatisation, seuilJours, await exigerWorkspaceCourant());
  redirect("/automatisations");
}
