// ADR-055 §F — le MANDAT : le contrat confié au professionnel pour une période donnée.
//
// Ce type ne porte aucune identité humaine. La qualité juridique de mandant (qui signe, qui engage
// l'indivision, qui est représenté) est une RELATION, `parties_mandat` (types/partieMandat.ts,
// ADR-060 §16) — jamais une colonne du mandat, jamais `parties_projet` (la participation à un
// projet de vente n'est pas la signature d'un contrat).
//
// `workspaceId` n'apparaît pas : le mandat est une feuille de `biens`, son périmètre est celui du
// bien (ADR-054 §7).
// ADR-060 §3 — vocabulaire d'ADR-055 §F. Rien d'autre, jamais un vocabulaire réseau.
export const TYPES_MANDAT = ["simple", "exclusif", "semi_exclusif"] as const;
export type TypeMandat = (typeof TYPES_MANDAT)[number];

export function estTypeMandat(valeur: unknown): valeur is TypeMandat {
  return typeof valeur === "string" && (TYPES_MANDAT as readonly string[]).includes(valeur);
}

export const LABEL_TYPE_MANDAT: Record<TypeMandat, string> = {
  simple: "Simple",
  exclusif: "Exclusif",
  semi_exclusif: "Semi-exclusif",
};

export type Mandat = {
  id: string;
  bienId: string;
  // Absent quand le mandat vient d'une opportunité antérieure au modèle canonique.
  projetVendeurId?: string;
  // ADR-060 §3 — absent sur les mandats antérieurs au lot lifecycle : personne ne l'a saisi, et le
  // produit ne l'invente pas. Exigé par tout writer humain postérieur.
  type?: TypeMandat;
  // ADR-060 §12 — saisi par l'humain, jamais un identifiant fournisseur.
  numero?: string;
  // Prise d'effet (ADR-060 §5). Confondue aujourd'hui avec la date de signature — le produit ne
  // saisit qu'une seule date (voir le commentaire de `mandats` dans db/schema.ts).
  dateDebut: string;
  // Terme contractuel prévu, dernier jour couvert (ADR-060 §6). Jamais modifié par une résiliation.
  dateFin?: string;
  // ADR-060 §4 — borne d'exclusivité d'un semi-exclusif.
  exclusiviteJusquAu?: string;
  // Fin anticipée réelle, distincte du terme (ADR-060 §8).
  resilieLe?: string;
  motifResiliation?: string;
  // Le mandat que celui-ci remplace ou renouvelle. Le précédent n'est jamais modifié (CAS 7).
  remplaceMandatId?: string;
  creeLe: string;
};

// Nommé `StatutMandatDerive` et non `StatutMandat` : ce dernier existe déjà dans types/bien.ts avec
// un AUTRE vocabulaire ('actif' | 'suspendu' | 'expire'), celui du statut historique porté par le
// bien. Deux types homonymes aux valeurs différentes finiraient par être importés l'un pour
// l'autre — et 'suspendu' n'a aucun sens pour un contrat, qui est en cours, arrivé à terme ou rompu.
export type StatutMandatDerive = "a_venir" | "actif" | "expire" | "resilie";

export const LABEL_STATUT_MANDAT_DERIVE: Record<StatutMandatDerive, string> = {
  a_venir: "À venir",
  actif: "Actif",
  expire: "Expiré",
  resilie: "Résilié",
};

// Dérivé, jamais stocké — même principe que deriverStatutCommercial (ADR-014) et
// deriverStatutProspectVendeur (ADR-027). Un statut stocké deviendrait faux tout seul, le lendemain
// du jour où le mandat expire, sans qu'aucune écriture ne le corrige.
//
// « Remplacé » n'est volontairement PAS un statut : c'est une relation portée par le successeur, pas
// une propriété du mandat remplacé — et la déduire exigerait une requête, ce qui ferait de cette
// fonction autre chose qu'une fonction pure sur la ligne.
//
// `aujourdhui` est un paramètre plutôt qu'un appel à `new Date()` : une fonction pure et testable
// sans horloge, même discipline que le reste des dérivations du dépôt.
// ADR-060 §7 — ordre de dérivation, bornes INCLUSIVES : un mandat qui commence aujourd'hui est
// actif, un mandat dont le terme est aujourd'hui court encore, un mandat résilié aujourd'hui est
// résilié. Seuls les trois champs de dates comptent ; `type`, `numero`, `remplace_mandat_id`
// n'entrent jamais dans le statut d'une ligne.
export function deriverStatutMandat(
  mandat: Pick<Mandat, "dateDebut" | "dateFin" | "resilieLe">,
  aujourdhui: string
): StatutMandatDerive {
  // La résiliation l'emporte : elle a mis fin au contrat avant son terme, quel que soit le terme —
  // et même si la prise d'effet est encore à venir (une résiliation constatée est un fait).
  if (mandat.resilieLe && mandat.resilieLe <= aujourdhui) return "resilie";
  if (mandat.dateDebut > aujourdhui) return "a_venir";
  // Le terme est le DERNIER jour couvert : un mandat dont la fin est aujourd'hui court encore.
  if (mandat.dateFin && mandat.dateFin < aujourdhui) return "expire";
  return "actif";
}

// Lecture d'historique (ADR-060 §10) : la ligne, son statut dérivé et, si un successeur la
// référence, l'identifiant de ce successeur. « Remplacé » reste une relation, jamais un statut.
export type MandatHistorique = Mandat & {
  statut: StatutMandatDerive;
  remplaceParId?: string;
};
