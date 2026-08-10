export type PoiProche = {
  nom: string;
  distanceMetres: number; // à vol d'oiseau
  detail?: string; // ex. type de cuisine — uniquement si la source le fournit, jamais déduit
};

export type CommercesProximite = {
  alimentation: PoiProche[];
  boulangeries: PoiProche[];
  pharmacies: PoiProche[];
  marches: PoiProche[];
  parcs: PoiProche[];
  sport: PoiProche[];
  sante: PoiProche[];
  // Récupérés mais volontairement non affichés pour l'instant : sans note ni signal de
  // pertinence, les deux plus proches ne sont pas forcément les plus utiles au conseiller.
  restaurants: PoiProche[];
  source: "openstreetmap_overpass";
  recupereLe: string;
};
