export type Coordonnees = { lat: number; lon: number };

// Dérivée du score IGN, jamais stockée sur ResultatGeocodage lui-même : la donnée brute de
// l'IGN ne doit pas être modifiée, seulement interprétée au moment de l'utiliser.
export type QualiteGeocodage = "fiable" | "a_verifier" | "insuffisant";

// Résultat brut du géocodeur : le score n'est jamais filtré ici — une adresse mal
// reconnue (ex. rue inexistante) renvoie quand même un candidat, avec un score faible.
// C'est à l'affichage de décider quoi en faire, jamais au client de le masquer.
export type ResultatGeocodage = {
  coordonnees: Coordonnees;
  score: number;
  labelTrouve: string;
  source: "ign_geoplateforme";
  recupereLe: string;
};
