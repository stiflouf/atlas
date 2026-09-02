import type { Opportunite, PrioriteOpportunite, TypeOpportunite } from "@/types/opportunite";

// Même patron que lib/alertes/priorite.ts : poids de priorité dominant, poids de type en
// départage, id déterministe en tie-break final. Convention produit interne, jamais affichée.
const POIDS_PRIORITE: Record<PrioriteOpportunite, number> = {
  haute: 300,
  moyenne: 200,
  basse: 100,
};

// À priorité égale : une relance vendeur engage un mandat non encore acquis, un suivi de visite
// engage une vente en cours, un match n'engage encore rien, une vérification est un préalable.
const POIDS_TYPE: Record<TypeOpportunite, number> = {
  relance_prospect_vendeur: 4,
  suivi_visite: 3,
  match_a_exploiter: 2,
  information_a_verifier: 1,
};

export function scoreOpportunite(opportunite: Opportunite): number {
  return POIDS_PRIORITE[opportunite.priorite] + POIDS_TYPE[opportunite.type];
}

export function trierOpportunites(opportunites: Opportunite[]): Opportunite[] {
  return [...opportunites].sort((a, b) => {
    const parScore = scoreOpportunite(b) - scoreOpportunite(a);
    if (parScore !== 0) return parScore;
    // Ancienneté ensuite : à situation équivalente, le dossier qui attend depuis le plus longtemps
    // passe devant. Une ancienneté inconnue ne prend jamais la place d'une ancienneté connue.
    const parAnciennete = (b.depuisJours ?? -1) - (a.depuisJours ?? -1);
    if (parAnciennete !== 0) return parAnciennete;
    // Tie-break stable, jamais l'ordre d'insertion (qui dépendrait de l'ordre des règles).
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
