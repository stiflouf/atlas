// ADR-055 §F — le MANDAT : le contrat confié au professionnel pour une période donnée.
//
// Ce type ne porte aucune identité humaine. Les mandants ne sont PAS modélisés dans ce lot : la
// qualité juridique de mandant (qui signe, qui engage l'indivision, qui est représenté) n'est pas
// la même chose que la participation à un projet de vente, et réutiliser `parties_projet` pour
// l'affirmer inventerait un fait juridique. Aucun écran, aucune règle et aucun document ne
// consomme cette information aujourd'hui — la frontière est documentée, pas devinée.
//
// `workspaceId` n'apparaît pas : le mandat est une feuille de `biens`, son périmètre est celui du
// bien (ADR-054 §7).
export type Mandat = {
  id: string;
  bienId: string;
  // Absent quand le mandat vient d'une opportunité antérieure au modèle canonique.
  projetVendeurId?: string;
  // Prise d'effet. Confondue aujourd'hui avec la date de signature — le produit ne saisit qu'une
  // seule date (voir le commentaire de `mandats` dans db/schema.ts).
  dateDebut: string;
  dateFin?: string;
  resilieLe?: string;
  // Le mandat que celui-ci remplace ou renouvelle. Le précédent n'est jamais modifié (CAS 7).
  remplaceMandatId?: string;
  creeLe: string;
};

// Nommé `StatutMandatDerive` et non `StatutMandat` : ce dernier existe déjà dans types/bien.ts avec
// un AUTRE vocabulaire ('actif' | 'suspendu' | 'expire'), celui du statut historique porté par le
// bien. Deux types homonymes aux valeurs différentes finiraient par être importés l'un pour
// l'autre — et 'suspendu' n'a aucun sens pour un contrat, qui est en cours, arrivé à terme ou rompu.
export type StatutMandatDerive = "actif" | "expire" | "resilie";

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
export function deriverStatutMandat(mandat: Mandat, aujourdhui: string): StatutMandatDerive {
  // La résiliation l'emporte : elle a mis fin au contrat avant son terme, quel que soit le terme.
  if (mandat.resilieLe && mandat.resilieLe <= aujourdhui) return "resilie";
  // Le terme est le DERNIER jour couvert : un mandat dont la fin est aujourd'hui court encore.
  if (mandat.dateFin && mandat.dateFin < aujourdhui) return "expire";
  return "actif";
}
