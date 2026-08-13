import type { AlerteCopilote, NiveauAlerte, TypeAlerte } from "@/types/alerte";

// Même principe que tachePriority.ts : score = niveau (dominant) + poids fixe documenté par type
// (convention produit interne, jamais un score affiché à l'UI) + id comme tie-break stable.
const POIDS_NIVEAU: Record<NiveauAlerte, number> = {
  action_requise: 300,
  attention: 200,
  information: 100,
};

// Ordre produit recommandé (du plus prioritaire au moins prioritaire), à poids niveau égal :
// 1. profil fiscal absent / données fiscales bloquantes (profil inconnu, régime non couvert)
// 2. assiette incomplète
// 3. rémunérations manquantes
// 4. dates d'encaissement manquantes
// 5. faits fiscaux/commerciaux constatés (dépassement micro, deux années, encaissement dépassé)
// 6. contrôle RFR/VFL non vérifiable
// 7. règle légale absente (limite du référentiel Atlas)
// 8. dépassement projeté
// 9. historique statistique trop jeune
// 10. règles futures hypothétiques
const POIDS_TYPE: Record<TypeAlerte, number> = {
  profil_fiscal_absent: 13,
  profil_fiscal_inconnu: 12,
  regime_non_couvert: 12,
  assiette_incomplete: 11,
  remuneration_manquante: 10,
  date_encaissement_prevue_manquante: 9,
  depassement_micro_constate: 8,
  deux_annees_depassement: 8,
  encaissement_attendu_depasse: 8,
  eligibilite_vfl_non_verifiable: 7,
  regle_legale_absente: 6,
  depassement_projete: 5,
  historique_run_rate_insuffisant: 4,
  regles_futures_hypothetiques: 3,
};

export function scoreAlerte(alerte: AlerteCopilote): number {
  return POIDS_NIVEAU[alerte.niveau] + POIDS_TYPE[alerte.type];
}

function comparerAlertes(a: AlerteCopilote, b: AlerteCopilote): number {
  const diff = scoreAlerte(b) - scoreAlerte(a);
  if (diff !== 0) return diff;
  // Tie-break stable et déterministe, jamais l'ordre d'insertion (qui dépendrait de l'ordre des
  // règles dans le code) : l'id lui-même, qui encode déjà type + dossier + année + code.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function trierParPriorite(alertes: AlerteCopilote[]): AlerteCopilote[] {
  return [...alertes].sort(comparerAlertes);
}
