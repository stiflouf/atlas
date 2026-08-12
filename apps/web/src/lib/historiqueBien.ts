import type { Bien } from "@/types/bien";
import type { ActionMetier } from "@/types/action";
import { LABEL_INTERET, type CompteRenduVisite } from "@/types/compteRenduVisite";
import type { Offre } from "@/types/offre";
import type { Compromis } from "@/types/compromis";

function formatPrix(montant: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    montant
  );
}

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
  comptesRendus: CompteRenduVisite[] = [],
  offres: Offre[] = [],
  compromis: Compromis[] = []
): EvenementHistorique[] {
  const evenements: EvenementHistorique[] = [];

  if (bien.creeLe) {
    evenements.push({ date: bien.creeLe, texte: "Bien créé" });
  }

  // Dérivés en direct de bien.offreEnCoursLe/compromisSigneLe (ADR-014) — pas d'un journal
  // immuable : annuler un jalon efface rétroactivement l'événement correspondant de l'historique,
  // conséquence assumée (voir docs/KNOWN_LIMITATIONS.md).
  if (bien.offreEnCoursLe) {
    evenements.push({ date: bien.offreEnCoursLe, texte: "Offre en cours" });
  }
  if (bien.compromisSigneLe) {
    evenements.push({ date: bien.compromisSigneLe, texte: "Compromis signé" });
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

  // Un seul événement par offre, à la création — jamais l'acquéreur nommé (même convention que
  // les visites, le détail vit dans l'onglet Offres). Aucun événement pour un changement de
  // statut : pas de date de transition fiable disponible (ADR-015), le statut courant se
  // consulte dans l'onglet Offres, pas dans l'historique.
  for (const offre of offres) {
    evenements.push({ date: offre.dateOffre, texte: `Offre reçue — ${formatPrix(offre.montant)}` });
  }

  // Un seul événement par compromis, à la création — jamais l'acquéreur nommé (même convention).
  // Libellé "Compromis structuré" (pas "Compromis signé") pour rester distinct de l'événement
  // générique ADR-014 dérivé de bien.compromisSigneLe, qui coexiste séparément ci-dessus : l'un
  // est le jalon commercial synthétique du bien, l'autre la création de l'entité détaillée.
  // Aucun événement pour un changement de statut : pas de date de transition fiable disponible
  // (ADR-016).
  for (const c of compromis) {
    evenements.push({ date: c.dateSignature, texte: `Compromis structuré — ${formatPrix(c.prixConvenu)}` });

    // Exception à "pas d'événement pour un changement de statut" : contrairement aux autres
    // transitions, 'realise' porte désormais une date fiable (dateActeReelle, ADR-017), posée
    // atomiquement avec le statut — jamais affiché si l'une des deux conditions manque.
    if (c.statut === "realise" && c.dateActeReelle) {
      evenements.push({ date: c.dateActeReelle, texte: `Vente finalisée — ${formatPrix(c.prixConvenu)}` });
    }
  }

  return evenements.sort((a, b) => (a.date < b.date ? 1 : -1));
}
