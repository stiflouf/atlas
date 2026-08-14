import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { EvaluationCritere, ResultatCompatibilite, StatutCompatibilite } from "./types";
import {
  evaluerAccessibilite,
  evaluerBudgetMax,
  evaluerExterieur,
  evaluerParking,
  evaluerPieces,
  evaluerSurface,
} from "./criteres";

// Agrégation (ADR-034) — les critères non_concerne sont ignorés : ils ne disent rien sur ce couple
// bien/acquéreur, ni positif ni négatif. Parmi les critères pertinents : un seul incompatible
// suffit à rendre le dossier incompatible (priorité absolue) ; sinon un seul a_verifier suffit à
// rendre le statut a_verifier ; sinon compatible. Aucun score, aucune pondération.
function agregerStatutGlobal(criteres: EvaluationCritere[]): StatutCompatibilite {
  const pertinents = criteres.filter((c) => c.statut !== "non_concerne");
  if (pertinents.some((c) => c.statut === "incompatible")) return "incompatible";
  if (pertinents.some((c) => c.statut === "a_verifier")) return "a_verifier";
  return "compatible";
}

// Fonction pure canonique (ADR-034) — zéro fetch, zéro Drizzle, zéro Date courante, zéro effet de
// bord, zéro texte libre interprété, déterministe pour les mêmes entrées. Source unique des règles
// de compatibilité commerciale — distincte de src/lib/matching/, qui résout un rendez-vous Google
// Calendar vers un bien/acquéreur par correspondance floue et ne participe jamais à cette décision.
export function evaluerCompatibilite(bien: Bien, acquereur: ProfilAcquereur): ResultatCompatibilite {
  const criteres: EvaluationCritere[] = [
    evaluerBudgetMax(bien, acquereur),
    evaluerPieces(bien, acquereur),
    evaluerSurface(bien, acquereur),
    evaluerParking(bien, acquereur),
    evaluerExterieur(bien, acquereur),
    evaluerAccessibilite(bien, acquereur),
  ];
  return {
    bienId: bien.id,
    acquereurId: acquereur.id,
    statutGlobal: agregerStatutGlobal(criteres),
    criteres,
  };
}
