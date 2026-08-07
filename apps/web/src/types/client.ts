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
};
