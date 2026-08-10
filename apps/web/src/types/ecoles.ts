// Statut tel que fourni par la source officielle — jamais déduit, absent si la source ne le
// renseigne pas.
export type StatutEtablissement = "Public" | "Privé";

export type EtablissementProche = {
  nom: string; // nom_etablissement tel que fourni par la source, jamais reformulé
  statut?: StatutEtablissement;
  distanceMetres: number; // à vol d'oiseau
};

export type EcolesProximite = {
  ecoles: EtablissementProche[];
  colleges: EtablissementProche[];
  lycees: EtablissementProche[];
  source: "annuaire_education_nationale";
  recupereLe: string;
};
