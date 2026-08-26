export type TypeBien = "appartement" | "maison" | "studio" | "loft" | "local_commercial";
export type StatutMandat = "actif" | "suspendu" | "expire";
export type Exterieur = "aucun" | "balcon" | "terrasse" | "jardin";

// Qui supporte les honoraires d'agence de la transaction (ADR-029) — jamais confondu avec
// remuneration.montantRemunerationConseillerCentimes (ADR-021, part du conseiller, un fait
// financier distinct). V1 volontairement binaire : aucune répartition réelle (montants/
// pourcentages par partie) n'est modélisée, "partagée" n'existe donc pas dans ce vocabulaire.
export type ChargeHonoraires = "vendeur" | "acquereur";

export const LABEL_CHARGE_HONORAIRES: Record<ChargeHonoraires, string> = {
  vendeur: "Vendeur",
  acquereur: "Acquéreur",
};

export const LABEL_STATUT_MANDAT: Record<StatutMandat, string> = {
  actif: "Actif",
  suspendu: "Suspendu",
  expire: "Expiré",
};

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
  // Code commune INSEE canonique (ADR-035) — résolu automatiquement depuis adresse/ville/
  // codePostal à chaque création/modification, jamais calculé à la lecture, jamais saisi
  // manuellement. Chaîne, jamais un entier (Corse : "2A"/"2B"). Absent si l'IGN était indisponible
  // ou le résultat insuffisamment fiable — ne remplace jamais adresse/ville/codePostal, qui
  // restent la saisie de référence pour l'affichage.
  codeInseeCommune?: string;
  // Déclaratif, texte libre (ADR-029) : pas d'entité copropriete en V1. Référence pour une
  // comparaison humaine avec documentBien.coproprieteDeclaree — jamais automatique.
  nomCopropriete?: string;
  // Condition du mandat (ADR-029), connue avant toute offre/tout compromis — voir ChargeHonoraires.
  chargeHonoraires?: ChargeHonoraires;
  // Absent pour les biens mockés (data/biens.ts) : aucune notion de date de création pour des
  // données statiques. Présent pour tout bien réel (colonne DB non nulle).
  creeLe?: string;
  // Absent = actif. Présent = archivé (sorti des flux actifs, jamais supprimé) — voir
  // ADR-012 et docs/BUSINESS_RULES.md.
  archiveLe?: string;
  // Jalons du statut commercial (ADR-014) — source de vérité unique, aucun statut dérivé stocké.
  // compromisSigneLe peut être présent sans offreEnCoursLe (compromis marqué directement).
  offreEnCoursLe?: string;
  compromisSigneLe?: string;
};
