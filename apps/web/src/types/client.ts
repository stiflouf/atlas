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
