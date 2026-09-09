import type { StadeProjet } from "./client";

// ADR-055 §B — projet acquéreur canonique : une intention immobilière située dans le temps.
//
// Ce type ne porte AUCUNE identité humaine (nom, prénom, email, téléphone) : les personnes qui
// portent ce projet sont des Contacts, atteints par `parties_projet`. Un projet peut en avoir deux
// (couple, coacquéreurs) — y recopier « le » nom obligerait à en désigner un arbitrairement.
//
// `workspaceId` n'apparaît volontairement pas ici : l'appartenance est une propriété
// d'infrastructure (ADR-054), pas une donnée métier affichable — même choix que `Bien`,
// `ProfilAcquereur` et `Contact`.
//
// `stadeProjet` réutilise le vocabulaire de `ProfilAcquereur` plutôt que d'en cloner un second :
// c'est le MÊME parcours commercial, décrit une seule fois.
export type ProjetAcquereur = {
  id: string;
  budgetMin: number;
  budgetMax: number;
  criteres: string[];
  stadeProjet: StadeProjet;
  // Critères structurés. Absent = non documenté, jamais interprété comme une valeur négative
  // (même discipline que ProfilAcquereur).
  piecesMin?: number;
  surfaceMin?: number;
  accessibiliteRequise?: boolean;
  necessiteParking?: boolean;
  necessiteExterieur?: boolean;
  creeLe: string;
  // Absent = actif. Présent = archivé (ADR-012) — tient lieu de cycle de vie, aucune machine à
  // états n'existe.
  archiveLe?: string;
};

// Le rôle vit sur la RELATION, jamais sur le Contact : c'est la participation à un projet
// acquéreur qui fait de quelqu'un un acquéreur. Vocabulaire limité au côté acquéreur — les rôles
// vendeur arriveront avec les projets vendeur.
export type RolePartieProjet = "acquereur" | "co_acquereur";

export type PartieProjet = {
  id: string;
  contactId: string;
  projetAcquereurId: string;
  role: RolePartieProjet;
  creeLe: string;
};
