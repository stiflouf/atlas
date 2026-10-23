import {
  LONGUEUR_MIN_MOTIF,
  MOTIFS_LEGAL_HOLD,
  TYPES_CIBLE_LEGAL_HOLD,
  type MotifLegalHold,
  type TypeCibleLegalHold,
} from "./statutsLegalHold";

// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — DOMAINE PUR du registre de suspension.
//
// Ce fichier n'importe ni la base, ni `process.env`, ni `next/*`, et ne lit pas l'horloge : il
// valide des entrées et répond à des questions. La frontière est la même que celle d'`eligibilite.ts`
// pour la rétention, et pour la même raison — ce qui décide qu'une donnée est protégée doit être
// testable sans Postgres, y compris sur ses cas limites.
//
// Il ne supprime rien, n'écrit rien, ne lit rien.

// Une SEULE classe d'erreur, et elle ne couvre que les entrées malformées — convention ADR-007 du
// dépôt : un cas métier attendu se rend par une union discriminée `{ statut }` (cible introuvable,
// hold déjà actif, hold déjà levé), jamais par une exception. Lever pour un état normal obligerait
// chaque appelant à un try/catch, et c'est exactement ce que `bonVisiteRepository` a refusé.
export class ErreurLegalHoldInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurLegalHoldInvalide";
  }
}

// FORME LUE du registre. `actif` n'est pas un champ stocké : il est DÉRIVÉ de `leveLe`, exactement
// comme en base (ADR-012 — un événement de cycle de vie binaire se représente par la date à laquelle
// il survient, pas par une case à cocher). Un second champ stocké pourrait contredire les dates, et
// c'est le plus permissif des deux qui finirait par décider d'une suppression.
export interface LegalHold {
  readonly id: string;
  readonly workspaceId: string;
  readonly entityType: TypeCibleLegalHold;
  readonly entityId: string;
  readonly motifCode: MotifLegalHold;
  readonly motif: string;
  readonly poseLe: Date;
  readonly poseParIdentiteSub: string;
  readonly leveLe?: Date;
  readonly leveParIdentiteSub?: string;
  readonly motifLevee?: string;
}

export function estActif(hold: Pick<LegalHold, "leveLe">): boolean {
  return hold.leveLe === undefined || hold.leveLe === null;
}

const TYPES_CIBLE = new Set<string>(TYPES_CIBLE_LEGAL_HOLD);
const MOTIFS = new Set<string>(MOTIFS_LEGAL_HOLD);

export function validerTypeCible(valeur: unknown): TypeCibleLegalHold {
  if (typeof valeur !== "string" || !TYPES_CIBLE.has(valeur)) {
    throw new ErreurLegalHoldInvalide(
      `Type de cible de legal hold non supporté : seuls ${TYPES_CIBLE_LEGAL_HOLD.join(", ")} sont lus par le moteur de rétention.`
    );
  }
  return valeur as TypeCibleLegalHold;
}

export function validerMotifCode(valeur: unknown): MotifLegalHold {
  if (typeof valeur !== "string" || !MOTIFS.has(valeur)) {
    throw new ErreurLegalHoldInvalide("Motif de legal hold hors vocabulaire : aucun motif libre n'est accepté.");
  }
  return valeur as MotifLegalHold;
}

// MOTIVATION OBLIGATOIRE. La valeur refusée n'est jamais interpolée dans le message : un motif décrit
// une affaire et peut nommer des personnes — on ne le recopie pas dans un journal d'erreur.
export function validerMotif(valeur: unknown, champ: "motif" | "motifLevee"): string {
  if (typeof valeur !== "string" || valeur.trim().length < LONGUEUR_MIN_MOTIF) {
    throw new ErreurLegalHoldInvalide(
      `Le champ ${champ} d'un legal hold est obligatoire et doit faire au moins ${LONGUEUR_MIN_MOTIF} caractères utiles : un hold non motivé ne peut être ni audité ni levé en connaissance de cause.`
    );
  }
  return valeur.trim();
}

export function validerWorkspaceId(valeur: unknown): string {
  if (typeof valeur !== "string" || valeur.trim().length === 0) {
    throw new ErreurLegalHoldInvalide(
      "Le périmètre (workspaceId) est obligatoire : un hold sans appartenance ne pourrait être ni isolé ni audité."
    );
  }
  return valeur;
}

export function validerIdentiteSub(valeur: unknown, champ: string): string {
  if (typeof valeur !== "string" || valeur.trim().length === 0) {
    throw new ErreurLegalHoldInvalide(
      `Le champ ${champ} est obligatoire : un acte du registre de conservation sans auteur identifié n'est pas auditable.`
    );
  }
  return valeur.trim();
}

// QUESTION CENTRALE, et elle est posée sur un ENSEMBLE déjà chargé plutôt que ligne par ligne : le
// moteur de rétention évalue un lot de candidats, et une interrogation par candidat ferait dépendre
// la protection du nombre de requêtes réussies.
//
// FAIL-CLOSED par le TYPE : l'ensemble est un paramètre obligatoire. Il n'existe aucun appel où il
// serait absent et où la fonction répondrait « non protégé » par défaut — une lecture de holds en
// échec doit faire échouer l'évaluation en amont, jamais produire un faux « aucune protection ».
export function estSousLegalHold(cibles: ReadonlySet<string>, entityId: string): boolean {
  return cibles.has(entityId);
}

// Clé d'unicité LOGIQUE d'un hold actif, identique à celle de l'index partiel
// `legal_holds_cible_actif_unique`. Exportée pour qu'un test puisse prouver que les deux coïncident,
// plutôt que de le supposer.
export function cleUniciteHoldActif(
  hold: Pick<LegalHold, "workspaceId" | "entityType" | "entityId" | "motifCode">
): string {
  return [hold.workspaceId, hold.entityType, hold.entityId, hold.motifCode].join("|");
}
