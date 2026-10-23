import {
  CAUSES_LEVEE_QUARANTAINE,
  LONGUEUR_MIN_MOTIF_QUARANTAINE,
  POLITIQUES_QUARANTAINE,
  TYPES_CIBLE_QUARANTAINE,
  type CauseLeveeQuarantaine,
  type EtatQuarantaine,
  type PolitiqueQuarantaine,
  type TypeCibleQuarantaine,
  type VerdictRevalidationQuarantaine,
} from "./statutsQuarantaine";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — DOMAINE PUR de la quarantaine.
//
// Ce fichier n'importe ni la base, ni `process.env`, ni `next/*`, et ne lit JAMAIS l'horloge :
// l'instant de référence est un paramètre obligatoire, pour la même raison qu'`eligibilite.ts` —
// l'état d'une quarantaine est une comparaison entre deux dates, et une fonction qui irait chercher
// l'une des deux toute seule ne pourrait pas être testée sur la frontière exacte, le seul endroit
// où elle peut se tromper.
//
// Il ne supprime rien, n'écrit rien, ne lit rien.

export class ErreurQuarantaineInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurQuarantaineInvalide";
  }
}

// FORME LUE du registre. Ni `etat`, ni `actif` : l'état est DÉRIVÉ (voir `etatQuarantaine`), comme
// en base. Un champ stocké en plus des dates pourrait les contredire, et c'est le plus permissif
// des deux qui finirait par décider d'une purge.
export interface Quarantaine {
  readonly id: string;
  readonly workspaceId: string;
  readonly policyCode: PolitiqueQuarantaine;
  readonly entityType: TypeCibleQuarantaine;
  readonly entityId: string;
  readonly motif: string;
  readonly entreLe: Date;
  readonly entreParIdentiteSub: string;
  readonly revalidationDueLe: Date;
  readonly leveeLe?: Date;
  readonly leveeParIdentiteSub?: string;
  readonly causeLevee?: CauseLeveeQuarantaine;
  readonly motifLevee?: string;
}

// ÉTAT DÉRIVÉ, dans cet ordre précis. `REVALIDATION_REQUISE` ne veut pas dire « supprimable » : il
// n'existe aucun état qui le dise, et c'est volontaire (voir statutsQuarantaine.ts).
export function etatQuarantaine(
  quarantaine: Pick<Quarantaine, "revalidationDueLe" | "leveeLe">,
  instantReference: Date
): EtatQuarantaine {
  if (quarantaine.leveeLe !== undefined && quarantaine.leveeLe !== null) return "LEVEE";
  // `>=` et non `>` : l'échéance est atteinte À l'instant de l'échéance, même convention
  // qu'`evaluerBonVisiteSigne`. Une échéance qui ne vaudrait qu'à la milliseconde suivante serait
  // une échéance plus un epsilon non écrit.
  if (instantReference.getTime() >= quarantaine.revalidationDueLe.getTime()) return "REVALIDATION_REQUISE";
  return "EN_QUARANTAINE";
}

export function estActive(quarantaine: Pick<Quarantaine, "leveeLe">): boolean {
  return quarantaine.leveeLe === undefined || quarantaine.leveeLe === null;
}

const TYPES_CIBLE = new Set<string>(TYPES_CIBLE_QUARANTAINE);
const POLITIQUES = new Set<string>(POLITIQUES_QUARANTAINE);
const CAUSES = new Set<string>(CAUSES_LEVEE_QUARANTAINE);

export function validerTypeCibleQuarantaine(valeur: unknown): TypeCibleQuarantaine {
  if (typeof valeur !== "string" || !TYPES_CIBLE.has(valeur)) {
    throw new ErreurQuarantaineInvalide(
      `Type de cible de quarantaine non supporté : seuls ${TYPES_CIBLE_QUARANTAINE.join(", ")} sont relus par la revalidation.`
    );
  }
  return valeur as TypeCibleQuarantaine;
}

export function validerPolitiqueQuarantaine(valeur: unknown): PolitiqueQuarantaine {
  if (typeof valeur !== "string" || !POLITIQUES.has(valeur)) {
    throw new ErreurQuarantaineInvalide(
      "Politique de quarantaine hors vocabulaire : seule une politique dont l'échéance est calculable peut produire un candidat."
    );
  }
  return valeur as PolitiqueQuarantaine;
}

export function validerCauseLevee(valeur: unknown): CauseLeveeQuarantaine {
  if (typeof valeur !== "string" || !CAUSES.has(valeur)) {
    throw new ErreurQuarantaineInvalide("Cause de levée de quarantaine hors vocabulaire : aucune cause libre n'est acceptée.");
  }
  return valeur as CauseLeveeQuarantaine;
}

// MOTIVATION OBLIGATOIRE. La valeur refusée n'est jamais interpolée dans le message : un motif peut
// décrire une situation nominative, et n'a rien à faire dans un journal d'erreur.
export function validerMotifQuarantaine(valeur: unknown, champ: "motif" | "motifLevee"): string {
  if (typeof valeur !== "string" || valeur.trim().length < LONGUEUR_MIN_MOTIF_QUARANTAINE) {
    throw new ErreurQuarantaineInvalide(
      `Le champ ${champ} d'une quarantaine est obligatoire et doit faire au moins ${LONGUEUR_MIN_MOTIF_QUARANTAINE} caractères utiles : un état non motivé n'est pas revalidable en connaissance de cause.`
    );
  }
  return valeur.trim();
}

export function validerIdentiteSubQuarantaine(valeur: unknown, champ: string): string {
  if (typeof valeur !== "string" || valeur.trim().length === 0) {
    throw new ErreurQuarantaineInvalide(
      `Le champ ${champ} est obligatoire : un acte du registre de rétention sans auteur identifié n'est pas auditable.`
    );
  }
  return valeur.trim();
}

export function validerWorkspaceIdQuarantaine(valeur: unknown): string {
  if (typeof valeur !== "string" || valeur.trim().length === 0) {
    throw new ErreurQuarantaineInvalide(
      "Le périmètre (workspaceId) est obligatoire : une quarantaine sans appartenance ne pourrait être ni isolée ni auditée."
    );
  }
  return valeur;
}

// ÉCHÉANCE. Jamais calculée depuis la durée de CONSERVATION, et jamais fournie par défaut : aucune
// durée de quarantaine n'est décidée (ADR-069 §durée). Elle est donc validée, pas dérivée — la
// fonction refuse une date absente, invalide ou antérieure à l'entrée, et c'est tout ce qu'elle
// peut honnêtement faire.
export function validerEcheanceRevalidation(valeur: unknown, entreLe: Date): Date {
  if (!(valeur instanceof Date) || Number.isNaN(valeur.getTime())) {
    throw new ErreurQuarantaineInvalide(
      "L'échéance de revalidation est obligatoire : aucune durée de quarantaine n'est décidée dans le produit, elle ne peut donc pas être calculée."
    );
  }
  if (valeur.getTime() < entreLe.getTime()) {
    throw new ErreurQuarantaineInvalide(
      "L'échéance de revalidation ne peut pas précéder l'entrée en quarantaine : elle produirait un état né expiré."
    );
  }
  return valeur;
}

// CONTEXTE de revalidation. Chaque champ est OBLIGATOIRE : il n'existe aucun appel où l'un d'eux
// serait absent et où la fonction conclurait « rien ne bloque » par défaut. C'est la garantie
// fail-closed exprimée par le type — un `?` sur `sousLegalHoldActif` ferait d'un oubli de câblage
// une levée de protection.
export interface ContexteRevalidation {
  readonly cibleExiste: boolean;
  readonly sousLegalHoldActif: boolean;
  // La cible relève-t-elle TOUJOURS de la politique au titre de laquelle elle a été mise en
  // quarantaine ? Recalculé à l'instant de la revalidation sur les données fraîches, jamais repris
  // de l'évaluation qui avait conduit à l'entrée : c'est précisément ce que « revalider » veut dire.
  readonly politiqueToujoursApplicable: boolean;
}

// LA fonction du lot. Ordre des vérifications EXPLICITE, parce qu'il porte les garanties :
//
//   1. déjà levée                  -> rien à revalider
//   2. cible introuvable           -> fail-closed, jamais « rien ne bloque »
//   3. legal hold actif            -> AVANT l'échéance, délibérément : une protection juridique doit
//                                     être visible même sur une quarantaine jeune, et l'expiration
//                                     temporelle ne doit jamais pouvoir la contourner
//   4. politique plus applicable   -> la quarantaine n'a plus d'objet
//   5. échéance non atteinte       -> il est trop tôt pour conclure quoi que ce soit
//   6. sinon                       -> AUCUN_BLOCAGE_CONNU, qui n'autorise RIEN
//
// Aucun des six verdicts ne permet de supprimer : il n'existe dans le produit aucun chemin de
// suppression, et cette fonction n'en appelle aucun. Elle répond à une question, elle n'agit pas.
export function revaliderQuarantaine(
  quarantaine: Pick<Quarantaine, "revalidationDueLe" | "leveeLe">,
  contexte: ContexteRevalidation,
  instantReference: Date
): VerdictRevalidationQuarantaine {
  if (!estActive(quarantaine)) return "QUARANTAINE_LEVEE";
  if (!contexte.cibleExiste) return "CIBLE_INTROUVABLE";
  if (contexte.sousLegalHoldActif) return "BLOCKED_BY_LEGAL_HOLD";
  if (!contexte.politiqueToujoursApplicable) return "POLITIQUE_NON_APPLICABLE";
  if (etatQuarantaine(quarantaine, instantReference) !== "REVALIDATION_REQUISE") return "ECHEANCE_NON_ATTEINTE";
  return "AUCUN_BLOCAGE_CONNU";
}

// Clé d'unicité LOGIQUE d'une quarantaine ACTIVE, identique à celle de l'index partiel
// `retention_quarantines_cible_active_unique`. Exportée pour qu'un test prouve que les deux
// coïncident plutôt que de le supposer.
export function cleUniciteQuarantaineActive(
  quarantaine: Pick<Quarantaine, "workspaceId" | "entityType" | "entityId" | "policyCode">
): string {
  return [quarantaine.workspaceId, quarantaine.entityType, quarantaine.entityId, quarantaine.policyCode].join("|");
}
