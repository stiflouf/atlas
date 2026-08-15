// Entité métier minimale « visite » (ADR-040). Distincte de RendezVous (événement Calendar
// éphémère, jamais persisté) et de CompteRenduVisite (fait déclaratif après-coup, table séparée,
// jamais fusionnée ici — voir docs/adr/040-cycle-vie-visite.md). `statut` répond à "que s'est-il
// passé avec la visite ?" ; le résultat commercial ("quel est le retour de l'acquéreur ?") reste
// entièrement porté par CompteRenduVisite.interet, jamais dupliqué ici.
export type StatutVisite = "planifiee" | "realisee" | "annulee";

export const LABEL_STATUT_VISITE: Record<StatutVisite, string> = {
  planifiee: "Planifiée",
  realisee: "Réalisée",
  annulee: "Annulée",
};

export type Visite = {
  id: string;
  bienId: string;
  acquereurId: string;
  // Jour civil prévu (YYYY-MM-DD) — jamais un instant précis, voir schema.ts.
  datePrevue: string;
  statut: StatutVisite;
  // Référence vers la source externe (id RendezVous — Google Calendar "gcal-xxx" ou mock) : une
  // simple traçabilité d'origine, jamais la PK métier de la visite.
  rendezVousCalendarId: string;
  creeLe: string;
};
