// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — vocabulaires FERMÉS du registre de suspension.
//
// Même discipline que `statutsRetention.ts` : aucune chaîne libre, aucun repli. Une valeur hors
// vocabulaire ne reçoit pas de valeur par défaut, elle est refusée — un hold dont le type de cible
// ou le motif ne serait pas compris ne protégerait rien tout en se lisant comme une protection.
//
// Les trois listes ci-dessous sont la SOURCE des CHECK de la migration 0061, recopiés en SQL parce
// que PostgreSQL ne peut pas importer du TypeScript. Un test vérifie que les deux ne divergent pas :
// de ces deux listes, la plus permissive serait celle qui compte.

// TYPES DE CIBLE réellement supportés — un seul aujourd'hui, et c'est volontaire.
//
// `bons_visite` est le seul type pour lequel une politique de conservation déclare
// `legalHoldApplicable: true` (SIGNED_VISIT_FORM, ADR-065) ET dont le moteur de rétention consulte
// effectivement les holds. Ouvrir le vocabulaire à des types qu'aucun chemin ne lit aurait permis de
// poser des holds inertes, c'est-à-dire de croire protégé ce qui ne l'est pas.
export const TYPES_CIBLE_LEGAL_HOLD = ["bons_visite"] as const;

export type TypeCibleLegalHold = (typeof TYPES_CIBLE_LEGAL_HOLD)[number];

// MOTIFS. Un code fermé pour l'audit et le regroupement ; le texte libre `motif` porte l'affaire
// elle-même. Les deux sont exigés : le code seul ne dit pas de quoi il s'agit, le texte seul n'est
// pas agrégeable.
export const MOTIFS_LEGAL_HOLD = [
  "CONTENTIEUX",
  // Réclamation, mise en demeure, litige non encore judiciarisé. Distinct de CONTENTIEUX parce que
  // la levée n'obéit pas au même signal : l'un se clôt par une décision, l'autre par l'abandon de la
  // réclamation.
  "PRE_CONTENTIEUX",
  "OBLIGATION_CONSERVATION",
  "CONTROLE_OU_AUDIT",
  "DEMANDE_JURIDIQUE",
  // Dernier recours NOMMÉ plutôt qu'un fourre-tout silencieux : le texte `motif` reste obligatoire,
  // donc un hold « autre » est toujours documenté.
  "AUTRE_MOTIF_DOCUMENTE",
] as const;

export type MotifLegalHold = (typeof MOTIFS_LEGAL_HOLD)[number];

// Longueur minimale d'une motivation, en base (CHECK) ET ici. Elle n'a pas pour but de garantir la
// qualité d'un texte — elle empêche qu'un caractère unique tienne lieu de justification dans un
// registre dont la seule valeur est d'être relisible par un humain des années plus tard.
export const LONGUEUR_MIN_MOTIF = 10;

// Ce que ce lot NE livre pas, écrit une fois plutôt que répété en commentaire : poser un hold
// n'ouvre aucun chemin de suppression, et en lever un n'en déclenche aucun.
export const SUPPRESSION_SUR_LEVEE_SUPPORTEE = false;
