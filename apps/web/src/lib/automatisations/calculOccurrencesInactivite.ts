import { FUSEAU_HORAIRE_APP, joursCivilsEcoules } from "@/lib/temps";

// Fonction PURE (ADR-033, point 12) — aucun accès IO, entièrement testable sans Postgres. Le
// scanner (scanTemporel.ts) charge les données et appelle celle-ci ; elle ne fait que calculer.
export type CandidatInactiviteProspectVendeur = {
  prospectVendeurId: string;
  // Ancre = dernierContactLe s'il existe, sinon creeLe (ADR-033, point 2 — un prospect jamais
  // contacté doit pouvoir entrer dans le mécanisme, pas rester hors périmètre silencieusement).
  dernierContactLe?: string;
  creeLe: string;
};

export type OccurrenceInactiviteDue = {
  prospectVendeurId: string;
  ancreCycle: string;
};

// `maintenant` est un paramètre explicite, jamais un `new Date()` interne — condition nécessaire
// pour que le calcul soit déterministe et testable, et pour que "maintenant" ne change pas de jour
// civil au milieu d'un scan portant sur de nombreux prospects.
//
// `>= seuilJours`, jamais `=== seuilJours` (ADR-033, point 7) : un scan en retard doit encore
// détecter un seuil dépassé depuis plusieurs jours, pas seulement le jour exact du franchissement.
export function calculerOccurrencesInactiviteDues(
  maintenant: Date,
  seuilJours: number,
  candidats: CandidatInactiviteProspectVendeur[],
  fuseau: string = FUSEAU_HORAIRE_APP
): OccurrenceInactiviteDue[] {
  const occurrences: OccurrenceInactiviteDue[] = [];
  for (const candidat of candidats) {
    const ancreCycle = candidat.dernierContactLe ?? candidat.creeLe;
    const jours = joursCivilsEcoules(new Date(ancreCycle), maintenant, fuseau);
    if (jours >= seuilJours) {
      occurrences.push({ prospectVendeurId: candidat.prospectVendeurId, ancreCycle });
    }
  }
  return occurrences;
}
