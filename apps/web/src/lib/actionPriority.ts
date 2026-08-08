import type { ActionMetier } from "@/types/action";

// Logique de priorité déterministe — aucune IA : uniquement priorité explicite,
// échéance, retard éventuel et statut.
const POIDS_PRIORITE: Record<ActionMetier["priorite"], number> = {
  haute: 30,
  normale: 20,
  basse: 10,
};

const MS_PAR_JOUR = 1000 * 60 * 60 * 24;

function joursRestants(echeance: string, maintenant: Date): number {
  return Math.round((new Date(echeance).getTime() - maintenant.getTime()) / MS_PAR_JOUR);
}

export function estEnRetard(action: ActionMetier, maintenant: Date = new Date()): boolean {
  return action.echeance !== undefined && joursRestants(action.echeance, maintenant) < 0;
}

export function scoreAction(action: ActionMetier, maintenant: Date = new Date()): number {
  if (action.statut === "termine") return -Infinity;

  let score = POIDS_PRIORITE[action.priorite];
  if (action.echeance) {
    const restants = joursRestants(action.echeance, maintenant);
    if (restants < 0) score += 50; // en retard : priorité maximale
    else if (restants <= 2) score += 15; // échéance imminente
  }
  return score;
}

function comparerActions(a: ActionMetier, b: ActionMetier, maintenant: Date): number {
  const diff = scoreAction(b, maintenant) - scoreAction(a, maintenant);
  if (diff !== 0) return diff;
  // À score égal, la plus ancienne (celle qui attend depuis le plus longtemps) passe devant.
  return new Date(a.dateCreation).getTime() - new Date(b.dateCreation).getTime();
}

export function trierParPriorite(actions: ActionMetier[], maintenant: Date = new Date()): ActionMetier[] {
  return actions
    .filter((a) => a.statut !== "termine")
    .sort((a, b) => comparerActions(a, b, maintenant));
}

export function actionPrioritaire(
  actions: ActionMetier[],
  maintenant: Date = new Date()
): ActionMetier | undefined {
  return trierParPriorite(actions, maintenant)[0];
}

// Raison lisible pour laquelle un dossier mérite l'attention du conseiller,
// dérivée de l'action la plus prioritaire plutôt que stockée séparément.
export function raisonAction(action: ActionMetier): string {
  return action.contexte ?? action.titre;
}
