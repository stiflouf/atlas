import { CLES_POLITIQUES_CONSERVATION, type ClePolitiqueConservation } from "@/lib/privacy/conservation";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — vocabulaires FERMÉS du moteur de rétention.
//
// Trois listes, et trois seulement, parce que trois questions distinctes se posent et que les
// confondre est l'erreur qui rendrait un moteur de purge dangereux :
//
//   1. que peut-on faire de CETTE POLITIQUE aujourd'hui ?        -> StatutPolitiqueRetention
//   2. où en est CETTE LIGNE par rapport à l'échéance ?          -> VerdictEntiteRetention
//   3. POURQUOI est-ce bloqué, précisément ?                     -> CodeBlocageRetention
//
// Aucune chaîne libre, aucun repli : une politique dont le statut n'est pas calculable n'en reçoit
// pas un par défaut, elle est bloquée. Le vocabulaire des POLITIQUES, lui, n'est pas redéclaré ici —
// il vient de `lib/privacy/conservation.ts`, source canonique (ADR-065).

export { CLES_POLITIQUES_CONSERVATION };
export type { ClePolitiqueConservation };

// STATUT D'UNE POLITIQUE. Il répond à « de quoi ce produit est-il capable pour cette catégorie »,
// jamais à « cette donnée doit-elle partir ».
export const STATUTS_POLITIQUE_RETENTION = [
  // La politique est DÉJÀ respectée par un mécanisme existant, et aucun moteur de rétention n'a à
  // s'en mêler. Construire un scan pour une donnée qui expire d'elle-même ajouterait un chemin de
  // suppression là où il n'en faut aucun.
  "ALREADY_ENFORCED",
  // Un mécanisme existe et couvre le cas nominal, mais un écart connu subsiste. Ce n'est ni
  // « appliqué », ni « bloqué » : le dire autrement serait faux dans un sens ou dans l'autre.
  "PARTIAL_EXISTING_RUNTIME",
  // L'échéance est calculable à partir de données réelles, et le dry-run peut donc compter. Aucune
  // suppression n'en découle : ce statut n'autorise RIEN, il constate qu'un comptage est honnête.
  "COMPUTABLE_DRY_RUN_ONLY",
  // Le déclencheur de la durée n'existe pas, ou n'est pas fiable. Fabriquer une date à partir d'un
  // champ approchant est le défaut le plus grave possible ici : il produit des suppressions
  // justifiées par une chronologie inventée.
  "BLOCKED_MISSING_TRIGGER",
  // La durée n'est pas tranchée. `UNDECIDED` est une réponse, pas un trou (ADR-065 §3).
  "BLOCKED_UNDECIDED_POLICY",
  // Statuts réservés aux archives probatoires : aucune politique ne les porte à la sortie de ce lot
  // (SIGNED_VISIT_FORM est COMPUTABLE_DRY_RUN_ONLY, et ses blocages de suppression sont rendus
  // séparément). Ils deviendront le statut d'une politique le jour où un chemin de suppression
  // existera mais pas encore la suspension pour contentieux, ou pas encore la primitive fichier —
  // c'est-à-dire exactement l'état intermédiaire qu'il ne faut pas pouvoir confondre avec
  // « calculable ».
  "BLOCKED_MISSING_LEGAL_HOLD",
  "BLOCKED_MISSING_FILE_DELETE",
] as const;

export type StatutPolitiqueRetention = (typeof STATUTS_POLITIQUE_RETENTION)[number];

// VERDICT D'UNE ENTITÉ. Volontairement distinct du statut de politique : une politique calculable
// contient des lignes à différents stades, et « non encore échue » n'est pas « hors périmètre »,
// qui n'est pas « incompréhensible ».
export const VERDICTS_ENTITE_RETENTION = [
  "ELIGIBLE",
  "NOT_YET_ELIGIBLE",
  // La ligne ne relève pas de cette politique (un brouillon n'est pas un bon signé). Ce n'est pas
  // un blocage : rien n'est inconnu, la ligne n'est simplement pas concernée.
  "OUT_OF_SCOPE",
  // Fail-closed. Toute incohérence, toute valeur hors vocabulaire, toute absence de donnée
  // nécessaire au calcul arrive ici — jamais dans ELIGIBLE, et jamais convertie en date ancienne.
  "BLOCKED",
] as const;

export type VerdictEntiteRetention = (typeof VERDICTS_ENTITE_RETENTION)[number];

// CODES DE BLOCAGE. Nommer la cause est ce qui rend un blocage lisible par un humain qui devra
// décider, plutôt qu'un simple « non ».
export const CODES_BLOCAGE_RETENTION = [
  // PROSPECT_MARKETING. `prospects_vendeurs.dernier_contact_le` et
  // `projets_vendeur.dernier_contact_le` NE SONT PAS ce champ : leurs deux seuls écrivains sont des
  // gestes du conseiller (ajout d'une note, RDV d'estimation marqué réalisé). Les utiliser
  // prolongerait la durée de prospection par la seule activité de l'agence — exactement ce
  // qu'ADR-065 §3 refuse. Un test de non-régression le verrouille.
  "LAST_INBOUND_CONTACT_AT_MISSING",
  // CUSTOMER_MARKETING. Il n'existe aucun événement canonique de fin de relation : plusieurs
  // candidats existent (acte, perte, résiliation de mandat, archivage), aucun n'est LA fin, et
  // l'acquéreur n'a même aucun horodatage de sortie de parcours.
  "RELATIONSHIP_END_AT_MISSING",
  "POLICY_UNDECIDED",
  // Blocages de SUPPRESSION, pas de calcul. Ils n'empêchent pas de compter ; ils interdisent d'agir.
  "LEGAL_HOLD_MODEL_MISSING",
  "FILE_DELETE_PRIMITIVE_MISSING",
  "DELETE_PATH_MISSING",
  // Niveau entité.
  "SIGNED_AT_MISSING",
  "UNKNOWN_ENTITY_STATE",
  // Dérive : une politique présente dans conservation.ts que le moteur ne sait pas évaluer. Produit
  // un blocage, jamais un silence.
  "UNKNOWN_POLICY",
  "REPOSITORY_ERROR",
] as const;

export type CodeBlocageRetention = (typeof CODES_BLOCAGE_RETENTION)[number];

// MODES D'EXÉCUTION. `apply` est nommé et refusé — voir `executerDryRunRetention`.
export const MODES_RETENTION = ["dry-run", "apply"] as const;

export type ModeRetention = (typeof MODES_RETENTION)[number];

export const MODE_RETENTION_V1 = "dry-run" as const satisfies ModeRetention;

// Ce que ce lot NE livre pas, écrit une fois et lu partout plutôt que répété en commentaire.
export const APPLY_SUPPORTED = false;
