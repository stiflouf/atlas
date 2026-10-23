import type { ClePolitiqueConservation } from "@/lib/privacy/conservation";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — vocabulaires FERMÉS de la quarantaine de rétention.
//
// Même discipline que `statutsRetention.ts` et `statutsLegalHold.ts` : aucune chaîne libre, aucun
// repli. Et une propriété supplémentaire, qui est la raison d'être de ce fichier :
//
//   AUCUNE valeur d'AUCUNE de ces listes ne signifie « supprimable ».
//
// Ce n'est pas une omission à combler plus tard, c'est l'invariant du lot. Un vocabulaire qui
// contiendrait `PURGE_ALLOWED` rendrait la purge exprimable avant qu'aucun mécanisme sûr n'existe,
// et c'est toujours par là qu'un produit finit par supprimer ce qu'il ne fallait pas. Un test
// structurel le verrouille.

// ÉTATS d'une quarantaine — DÉRIVÉS des dates, jamais stockés (ADR-012). Trois, et trois seulement.
export const ETATS_QUARANTAINE = [
  // Entrée, échéance non atteinte. Rien à faire, et surtout rien à supprimer.
  "EN_QUARANTAINE",
  // Échéance atteinte. Cela signifie « une revalidation est EXIGÉE », jamais « la suppression est
  // autorisée ». C'est le nom lui-même qui porte la garantie : il n'existe aucun état intermédiaire
  // qu'on pourrait lire comme un feu vert.
  "REVALIDATION_REQUISE",
  // Sortie non destructive. La ligne demeure, avec son motif d'entrée, sa cause et son motif de
  // sortie : ce qui a été envisagé puis abandonné reste lisible.
  "LEVEE",
] as const;

export type EtatQuarantaine = (typeof ETATS_QUARANTAINE)[number];

// CAUSES DE SORTIE. Un code fermé, parce que ces sorties ne se valent pas à l'audit : « on a décidé
// d'arrêter » et « la politique ne s'applique plus » n'appellent ni la même relecture ni les mêmes
// conséquences. Le texte libre `motifLevee` porte l'affaire elle-même, et reste obligatoire.
export const CAUSES_LEVEE_QUARANTAINE = [
  "DECISION_MANUELLE",
  // La revalidation a montré que la ligne ne relève plus de la politique (un bon annulé, par
  // exemple) : la quarantaine n'a plus d'objet.
  "POLITIQUE_NON_APPLICABLE",
  "CIBLE_DISPARUE",
  // Un legal hold est apparu et l'on retire la cible du chemin de purge. AUCUN code ne pose cette
  // cause automatiquement : un hold ne lève pas de quarantaine tout seul (ADR-069 §legal hold), il
  // bloque la revalidation. Cette valeur existe pour un geste humain explicite.
  "LEGAL_HOLD_POSE",
] as const;

export type CauseLeveeQuarantaine = (typeof CAUSES_LEVEE_QUARANTAINE)[number];

// VERDICTS DE REVALIDATION. La question posée est « que sait-on aujourd'hui de cette quarantaine ? »,
// jamais « peut-on supprimer ? ».
export const VERDICTS_REVALIDATION_QUARANTAINE = [
  // La quarantaine est déjà sortie : il n'y a rien à revalider.
  "QUARANTAINE_LEVEE",
  // La cible n'existe plus, ou n'est pas dans ce périmètre. Fail-closed : jamais confondu avec
  // « plus rien ne bloque ».
  "CIBLE_INTROUVABLE",
  // Un legal hold actif protège la cible. Évalué AVANT l'échéance, délibérément : une protection
  // juridique doit être visible même sur une quarantaine encore jeune, et l'expiration temporelle
  // ne doit jamais pouvoir la contourner.
  "BLOCKED_BY_LEGAL_HOLD",
  // La ligne ne relève plus de la politique au titre de laquelle elle a été mise en quarantaine.
  "POLITIQUE_NON_APPLICABLE",
  "ECHEANCE_NON_ATTEINTE",
  // LE VERDICT LE PLUS PERMISSIF DU LOT, et il n'autorise RIEN. Il constate l'absence des blocages
  // que CE lot sait vérifier — pas l'existence d'un droit de supprimer. Aucun chemin de suppression
  // n'existe dans le produit, et le lot qui en livrera un devra ajouter ses propres vérifications
  // (préconditions fichier, chemin de suppression complet, voir `blocagesAvantSuppression`).
  // Il s'appelle « aucun blocage connu » et non « autorisé » pour cette raison exacte.
  "AUCUN_BLOCAGE_CONNU",
] as const;

export type VerdictRevalidationQuarantaine = (typeof VERDICTS_REVALIDATION_QUARANTAINE)[number];

// Types de cible réellement supportés — un seul, aligné sur `TYPES_CIBLE_LEGAL_HOLD` et sur la seule
// politique calculable. Un vocabulaire plus large permettrait d'ouvrir une quarantaine qu'aucun
// chemin ne relit.
export const TYPES_CIBLE_QUARANTAINE = ["bons_visite"] as const;

export type TypeCibleQuarantaine = (typeof TYPES_CIBLE_QUARANTAINE)[number];

// Politiques pouvant ouvrir une quarantaine : celles dont l'échéance est calculable
// (`COMPUTABLE_DRY_RUN_ONLY`, ADR-066). Une politique bloquée ne produit aucun candidat.
export const POLITIQUES_QUARANTAINE = ["SIGNED_VISIT_FORM"] as const satisfies readonly ClePolitiqueConservation[];

export type PolitiqueQuarantaine = (typeof POLITIQUES_QUARANTAINE)[number];

export const LONGUEUR_MIN_MOTIF_QUARANTAINE = 10;

// DURÉE DE QUARANTAINE : NON DÉCIDÉE.
//
// Aucune durée n'existe dans le produit — ni dans `conservation.ts` (ADR-065), ni dans aucune ADR,
// ni dans aucune règle produit. Elle n'est donc pas inventée ici : ni « 30 jours », ni « 90 jours »,
// ni une valeur dérivée de la durée de conservation.
//
// Ce n'est pas un trou, c'est une réponse — la même doctrine qu'`UNDECIDED` dans ADR-065 §3. La
// fonction ci-dessous rend `undefined` pour toute politique, ce qui fait remonter
// `QUARANTINE_POLICY_MISSING` dans le moteur de rétention et interdit à tout chemin automatique de
// calculer une échéance. L'échéance d'une quarantaine reste donc fournie explicitement par son
// appelant, et le jour où une durée sera tranchée, c'est ICI qu'elle apparaîtra — un seul endroit,
// et un test qui le constate.
export const DUREE_QUARANTINE_DECIDEE = false;

export function dureeQuarantainePour(_politique: PolitiqueQuarantaine): undefined {
  return undefined;
}
