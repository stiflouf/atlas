import type { Bien } from "@/types/bien";
import type { ActionMetier } from "@/types/action";
import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";

// Sans `auteur` : contrairement au DossierBien mocké (data/dossier.ts), un événement dérivé est
// un fait automatique — l'app est mono-conseiller (ADR-006), il n'y a personne d'honnête à nommer.
export type EvenementHistorique = { date: string; texte: string };

// Dérive l'historique d'un bien réel uniquement à partir de faits déjà persistés (creeLe/
// termineLe, comptes rendus de visite) — jamais de rendez-vous Google Calendar : la fenêtre
// d'agenda ne couvre que les 7 prochains jours, jamais le passé, donc aucune date de visite
// future-fetch n'est disponible ici (les comptes rendus, eux, sont réellement passés).
export function deriverHistoriqueBien(
  bien: Bien,
  actions: ActionMetier[],
  comptesRendus: CompteRenduVisite[] = []
): EvenementHistorique[] {
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

  // Événement court uniquement — jamais le texte libre de `retour`, qui reste consultable dans
  // la mémoire du dossier (page de préparation) et dans l'onglet Visites de la fiche bien.
  for (const compteRendu of comptesRendus) {
    evenements.push({
      date: compteRendu.dateVisite,
      texte: `Visite effectuée — ${LABEL_INTERET[compteRendu.interet]}`,
    });
  }

  return evenements.sort((a, b) => (a.date < b.date ? 1 : -1));
}
