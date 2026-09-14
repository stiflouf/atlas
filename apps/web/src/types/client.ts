export type StadeProjet =
  | "decouverte"
  | "recherche_active"
  | "offre"
  | "compromis"
  | "acte";

export const LABEL_STADE_PROJET: Record<StadeProjet, string> = {
  decouverte: "Découverte",
  recherche_active: "Recherche active",
  offre: "En attente d'offre",
  compromis: "Compromis",
  acte: "Acte",
};

export type ProfilAcquereur = {
  id: string;
  // ADR-057 — OPTIONNEL depuis que le Contact fait foi pour un dossier rattaché. `acquereurs.prenom`
  // reste NOT NULL, mais `contacts.prenom` est nullable : « Dupont » sans prénom est un état normal
  // (ADR-055 §A, `nom` est le seul champ que les deux modèles garantissent). Le traduire en chaîne
  // vide ferait passer une absence pour une valeur — la même altération de sens qu'un repli.
  prenom?: string;
  nom: string;
  // ADR-057 — OPTIONNELS depuis que le Contact fait foi pour un dossier rattaché. Les colonnes
  // `acquereurs.email`/`telephone` restent NOT NULL, mais `contacts.email`/`telephone` sont
  // nullables : un Contact sans adresse connue rend une identité effective sans email, et la
  // remplacer par celle du dossier serait exactement le repli champ par champ qu'ADR-057 interdit.
  // Absent = adresse/numéro inconnus, jamais une chaîne vide.
  email?: string;
  telephone?: string;
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
