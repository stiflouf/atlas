export type StadeProjet =
  | "decouverte"
  | "recherche_active"
  | "offre"
  | "compromis"
  | "acte";

export type ProfilAcquereur = {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  budgetMin: number;
  budgetMax: number;
  criteres: string[];
  stadeProjet: StadeProjet;
  notes: string;
  datePremiereContact: string;
  // Champs structurés pour les croisements bien × acquéreur (moteur de points d'attention).
  // Absent = non documenté/inconnu, jamais interprété comme une valeur négative.
  // accessibiliteRequise porte uniquement sur le besoin immobilier (accessibilité du logement
  // nécessaire dans la recherche) — jamais sur une information de santé ou de handicap.
  piecesMin?: number;
  surfaceMin?: number;
  accessibiliteRequise?: boolean;
  necessiteParking?: boolean;
  necessiteExterieur?: boolean;
  // Absent = actif. Présent = archivé (sorti des flux actifs, jamais supprimé) — voir
  // ADR-012 et docs/BUSINESS_RULES.md.
  archiveLe?: string;
};
