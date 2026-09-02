import type { CibleOpportunite, TypeOpportunite } from "@/types/opportunite";

// Même principe que construireIdAlerte (lib/alertes/id.ts) : identifiant déterministe dérivé de la
// cause, jamais un UUID ni un compteur. `complement` distingue deux opportunités du même type sur
// la même cible (ex. deux acquéreurs compatibles avec le même bien).
export function construireIdOpportunite(
  type: TypeOpportunite,
  cible: CibleOpportunite,
  complement?: string
): string {
  return `${type}:${cible.type}:${cible.id}:${complement ?? ""}`;
}
