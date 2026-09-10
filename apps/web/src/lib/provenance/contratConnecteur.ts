import type { TypeEntiteCanonique } from "@/types/provenance";

// ADR-056 §6/§7/§9 — la FRONTIÈRE, exprimée en types. Ce fichier ne contient aucun client HTTP,
// aucun protocole, aucun SDK : il dit seulement ce qu'un connecteur doit déclarer pour que le Core
// puisse refuser une écriture avant qu'elle ne parte.
//
// Sens des dépendances (§9) : CONNECTEURS -> SYNC ENGINE -> CORE. Le Core ne dépend de personne.
// Ce contrat vit du côté Core parce que c'est le Core qui doit pouvoir VÉRIFIER une capacité ; un
// connecteur l'importe, jamais l'inverse.
//
// Volontairement minimal : ni classe de base, ni registre, ni SDK. Un connecteur qui n'existe pas
// n'a pas besoin d'échafaudage, et une interface sans implémentation qui grossit devient une
// architecture imaginaire.

// ADR-056 §6 — déclarées PAR TYPE D'ENTITÉ, jamais globalement pour un fournisseur.
export type CapaciteSynchronisation = "read_only" | "pull" | "push" | "bidirectionnel";

export type DescripteurConnecteur = {
  // Clé technique stable, la même que `references_externes.fournisseur`.
  fournisseur: string;
  // Une entité absente de la table n'est PAS synchronisable : l'omission vaut refus, jamais
  // permission par défaut.
  capacites: Partial<Record<TypeEntiteCanonique, CapaciteSynchronisation>>;
};

// ADR-056 invariant 6 — une PROPRIÉTÉ du connecteur, vérifiée avant tout appel, jamais un réglage
// d'exécution qu'on pourrait oublier de lire. Précédent direct : le connecteur Google Calendar est
// en lecture seule par son scope OAuth lui-même, pas par intention.
export function peutEcrireVersExterieur(
  descripteur: DescripteurConnecteur,
  typeEntite: TypeEntiteCanonique
): boolean {
  const capacite = descripteur.capacites[typeEntite];
  return capacite === "push" || capacite === "bidirectionnel";
}

// ADR-056 §6 — IMPORTER vers DOMIORA exige `pull` ou `bidirectionnel`. `read_only` ne suffit pas,
// et la distinction n'est pas cosmétique : `read_only` dit « ce connecteur peut être interrogé »,
// `pull` dit « ce qu'il renvoie a vocation à entrer dans le Core ». Les confondre ferait écrire
// dans DOMIORA à partir d'une source qu'on s'était contenté d'autoriser à lire.
export function peutImporterVersDomiora(
  descripteur: DescripteurConnecteur,
  typeEntite: TypeEntiteCanonique
): boolean {
  const capacite = descripteur.capacites[typeEntite];
  return capacite === "pull" || capacite === "bidirectionnel";
}

// Un connecteur non déclaré pour une entité ne peut rien en lire non plus : « non configuré n'est
// pas en panne » (§7, point 2), mais ce n'est pas davantage une autorisation tacite.
export function peutLireDepuisExterieur(
  descripteur: DescripteurConnecteur,
  typeEntite: TypeEntiteCanonique
): boolean {
  return descripteur.capacites[typeEntite] !== undefined;
}
