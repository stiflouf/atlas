import type { Tache } from "@/types/tache";
import { deriverStatutTache } from "@/types/tache";

// ADR-028 : refonte de l'ancien actionPriority.ts pour le statut dérivé (deriverStatutTache) —
// même logique déterministe qu'avant (aucune IA : priorité explicite, échéance, retard éventuel),
// mais une tâche 'terminee' ET une tâche 'annulee' sont désormais toutes deux exclues des listes
// actives (l'ancien code n'excluait que 'termine', 'annule' n'existait pas).
const POIDS_PRIORITE: Record<Tache["priorite"], number> = {
  haute: 30,
  normale: 20,
  basse: 10,
};

const MS_PAR_JOUR = 1000 * 60 * 60 * 24;

function joursRestants(echeance: string, maintenant: Date): number {
  return Math.round((new Date(echeance).getTime() - maintenant.getTime()) / MS_PAR_JOUR);
}

export function estEnRetard(tache: Tache, maintenant: Date = new Date()): boolean {
  return tache.echeance !== undefined && joursRestants(tache.echeance, maintenant) < 0;
}

export function scoreTache(tache: Tache, maintenant: Date = new Date()): number {
  if (deriverStatutTache(tache) !== "a_faire") return -Infinity;

  let score = POIDS_PRIORITE[tache.priorite];
  if (tache.echeance) {
    const restants = joursRestants(tache.echeance, maintenant);
    if (restants < 0) score += 50; // en retard : priorité maximale
    else if (restants <= 2) score += 15; // échéance imminente
  }
  return score;
}

function comparerTaches(a: Tache, b: Tache, maintenant: Date): number {
  const diff = scoreTache(b, maintenant) - scoreTache(a, maintenant);
  if (diff !== 0) return diff;
  // À score égal, la plus ancienne (celle qui attend depuis le plus longtemps) passe devant.
  return new Date(a.creeLe).getTime() - new Date(b.creeLe).getTime();
}

export function trierParPriorite(taches: Tache[], maintenant: Date = new Date()): Tache[] {
  return taches
    .filter((t) => deriverStatutTache(t) === "a_faire")
    .sort((a, b) => comparerTaches(a, b, maintenant));
}

export function tachePrioritaire(taches: Tache[], maintenant: Date = new Date()): Tache | undefined {
  return trierParPriorite(taches, maintenant)[0];
}

// Raison lisible pour laquelle un dossier mérite l'attention du conseiller,
// dérivée de la tâche la plus prioritaire plutôt que stockée séparément.
export function raisonTache(tache: Tache): string {
  return tache.contexte ?? tache.titre;
}
