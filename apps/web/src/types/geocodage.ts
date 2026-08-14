export type Coordonnees = { lat: number; lon: number };

// Dérivée du score IGN, jamais stockée sur ResultatGeocodage lui-même : la donnée brute de
// l'IGN ne doit pas être modifiée, seulement interprétée au moment de l'utiliser.
export type QualiteGeocodage = "fiable" | "a_verifier" | "insuffisant";

// Une commune (ou un arrondissement municipal, traité par l'IGN comme sa propre commune —
// ADR-035) telle que retournée par la Base Adresse Nationale. `citycode` est le code commune
// INSEE — chaîne, jamais un entier (la Corse porte des codes départementaux non numériques,
// 2A/2B). `nom`/`codePostal`/`contexte` sont uniquement destinés à l'affichage, jamais comparés.
export type Commune = {
  citycode: string;
  nom: string;
  codePostal: string;
  // "78, Yvelines, Île-de-France" — département/région, utilisé pour désambiguïser les communes
  // homonymes à l'affichage (ex. plusieurs "Saint-Martin").
  contexte: string;
};

// Résultat brut du géocodeur : le score n'est jamais filtré ici — une adresse mal
// reconnue (ex. rue inexistante) renvoie quand même un candidat, avec un score faible.
// C'est à l'affichage de décider quoi en faire, jamais au client de le masquer.
export type ResultatGeocodage = {
  coordonnees: Coordonnees;
  score: number;
  labelTrouve: string;
  // Absent seulement si la réponse IGN ne porte exceptionnellement aucun citycode (non observé
  // en usage normal) — jamais déduit/reconstruit, uniquement ce que l'IGN a retourné.
  commune?: Commune;
  source: "ign_geoplateforme";
  recupereLe: string;
};
