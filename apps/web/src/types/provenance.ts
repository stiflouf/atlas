// ADR-056 — les primitives d'identité externe et de provenance. Aucun vocabulaire fournisseur
// n'apparaît ici : c'est précisément ce que l'invariant 7 interdit au Core.

// Les entités canoniques qu'un connecteur peut désigner. C'est un vocabulaire DOMIORA, jamais celui
// d'une source : le `buyer` de tel réseau devient `projet_acquereur`, ou n'est pas importé.
export type TypeEntiteCanonique =
  | "contact"
  | "projet_acquereur"
  | "projet_vendeur"
  | "bien"
  | "mandat"
  | "interaction";

// Exactement une cible, garantie par le type comme elle l'est par le `CHECK` en base.
export type CibleCanonique =
  | { type: "contact"; id: string }
  | { type: "projet_acquereur"; id: string }
  | { type: "projet_vendeur"; id: string }
  | { type: "bien"; id: string }
  | { type: "mandat"; id: string }
  | { type: "interaction"; id: string };

// Une entité verrouillable : un échange qui a eu lieu n'est pas corrigé par une synchronisation, il
// n'y a donc rien à y verrouiller.
export type CibleVerrouillable = Exclude<CibleCanonique, { type: "interaction" }>;

export type ReferenceExterne = {
  id: string;
  fournisseur: string;
  // Vocabulaire du fournisseur, conservé tel quel — jamais réinterprété comme un type DOMIORA.
  typeEntiteExterne: string;
  idExterne: string;
  cible: CibleCanonique;
  vuePourLaPremiereFoisLe: string;
  vuePourLaDerniereFoisLe: string;
};

export type ChampVerrouille = {
  id: string;
  cible: CibleVerrouillable;
  // Nom d'une propriété canonique DOMIORA (`budgetMax`), jamais un chemin fournisseur.
  champ: string;
  verrouilleLe: string;
};

// ADR-056 §5/§6 — la source de vérité est déclarée PAR (entité, fournisseur), jamais globalement.
// `externe` : le fournisseur fait foi pour les champs non verrouillés.
// `domiora` : DOMIORA fait foi ; le pull ne sert plus qu'à DÉTECTER des écarts.
export type SourceDeVerite = "domiora" | "externe";
