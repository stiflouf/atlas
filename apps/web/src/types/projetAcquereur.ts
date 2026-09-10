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

// Les champs de ce projet qu'un chemin d'écriture peut modifier UN PAR UN, sans passer par un
// formulaire complet. Liste FERMÉE, et c'est le Core qui la tient : elle dit ce qu'il accepte de
// voir bouger champ par champ, indépendamment de qui le demande.
//
// `stadeProjet`, `creeLe` et `archiveLe` en sont volontairement absents : le premier est le
// parcours commercial du conseiller, les deux autres sont du cycle de vie. Aucun des trois ne se
// corrige à la pièce.
export type ChampProjetAcquereurModifiable =
  | "budgetMin"
  | "budgetMax"
  | "criteres"
  | "piecesMin"
  | "surfaceMin"
  | "accessibiliteRequise"
  | "necessiteParking"
  | "necessiteExterieur";

// Le rôle vit sur la RELATION, jamais sur ce type : voir `PartieProjet` dans types/partieProjet.ts.
