import type { ActionMetier } from "@/types/action";
import { scoreAction } from "@/lib/actionPriority";

export type OrigineAction = "bien" | "acquereur";
export type ActionAvecOrigine = ActionMetier & { origine: OrigineAction };
export type EvenementMemoire = { date: string; texte: string };

// Fusionne les actions ouvertes du bien et de l'acquéreur en une seule liste triée par
// priorité — même moteur que l'accueil et la fiche bien (actionPriority.ts), aucune nouvelle
// règle de priorisation.
export function selectionnerActionsEnCours(
  actionsBien: ActionMetier[],
  actionsAcquereur: ActionMetier[],
  maintenant: Date = new Date(),
  maximum = 5
): ActionAvecOrigine[] {
  const combinees: ActionAvecOrigine[] = [
    ...actionsBien.filter((a) => a.statut === "a_faire").map((a) => ({ ...a, origine: "bien" as const })),
    ...actionsAcquereur.filter((a) => a.statut === "a_faire").map((a) => ({ ...a, origine: "acquereur" as const })),
  ];
  return combinees.sort((a, b) => scoreAction(b, maintenant) - scoreAction(a, maintenant)).slice(0, maximum);
}

function estTermineeAvecDate(action: ActionMetier): action is ActionMetier & { termineLe: string } {
  return action.statut === "termine" && action.termineLe !== undefined;
}

// Historique récent pour la préparation de visite : uniquement les actions du bien réellement
// terminées récemment. Jamais "Bien créé" (peu utile juste avant d'entrer dans le bien) et
// jamais les créations d'action (déjà visibles, pour celles encore ouvertes, dans "Actions en
// cours" juste au-dessus — les inclure ici doublonnerait la même information).
export function selectionnerHistoriqueRecent(actionsBien: ActionMetier[], maximum = 3): EvenementMemoire[] {
  return actionsBien
    .filter(estTermineeAvecDate)
    .sort((a, b) => (a.termineLe < b.termineLe ? 1 : -1))
    .slice(0, maximum)
    .map((a) => ({ date: a.termineLe, texte: `Action terminée : ${a.titre}` }));
}
