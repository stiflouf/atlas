import type { TypeAlerte } from "@/types/alerte";

// Identifiant déterministe d'une alerte — jamais un UUID, jamais un compteur incrémental. Deux
// évaluations successives sur le même contexte doivent produire le même id pour la même cause,
// c'est ce qui permet à la fois la déduplication et un tri stable (ADR-026).
export function construireIdAlerte(type: TypeAlerte, dossierFiscalId: string, annee?: number, code?: string): string {
  return `${type}:${dossierFiscalId}:${annee ?? ""}:${code ?? ""}`;
}
