import type { Bien } from "@/types/bien";
import type { ActionMetier } from "@/types/action";

// Sans `auteur` : contrairement au DossierBien mocké (data/dossier.ts), un événement dérivé est
// un fait automatique — l'app est mono-conseiller (ADR-006), il n'y a personne d'honnête à nommer.
export type EvenementHistorique = { date: string; texte: string };

// Dérive l'historique d'un bien réel uniquement à partir de faits déjà persistés (creeLe/
// termineLe) — jamais de rendez-vous Google Calendar : la fenêtre d'agenda ne couvre que les 7
// prochains jours, jamais le passé, donc aucune date de visite réelle n'est disponible ici.
export function deriverHistoriqueBien(bien: Bien, actions: ActionMetier[]): EvenementHistorique[] {
  const evenements: EvenementHistorique[] = [];

  if (bien.creeLe) {
    evenements.push({ date: bien.creeLe, texte: "Bien créé" });
  }

  for (const action of actions) {
    evenements.push({ date: action.creeLe, texte: `Action créée : ${action.titre}` });
    if (action.statut === "termine" && action.termineLe) {
      evenements.push({ date: action.termineLe, texte: `Action terminée : ${action.titre}` });
    }
  }

  return evenements.sort((a, b) => (a.date < b.date ? 1 : -1));
}
