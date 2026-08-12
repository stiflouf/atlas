export type TypeBien = "appartement" | "maison" | "studio" | "loft" | "local_commercial";
export type StatutMandat = "actif" | "suspendu" | "expire";
export type Exterieur = "aucun" | "balcon" | "terrasse" | "jardin";

export type Bien = {
  id: string;
  reference: string;
  titre: string;
  type: TypeBien;
  adresse: string;
  ville: string;
  codePostal: string;
  surface: number;
  pieces: number;
  prix: number;
  statutMandat: StatutMandat;
  dateMandat: string;
  caracteristiques: string[];
  description: string;
  // Champs structurés pour les croisements bien × acquéreur (moteur de points d'attention).
  // Absent = non documenté/inconnu, jamais interprété comme une valeur négative.
  etage?: number;
  ascenseur?: boolean;
  parking?: boolean;
  exterieur?: Exterieur;
  // Absent pour les biens mockés (data/biens.ts) : aucune notion de date de création pour des
  // données statiques. Présent pour tout bien réel (colonne DB non nulle).
  creeLe?: string;
  // Absent = actif. Présent = archivé (sorti des flux actifs, jamais supprimé) — voir
  // ADR-012 et docs/BUSINESS_RULES.md.
  archiveLe?: string;
};
