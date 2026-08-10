export type ArretTransportProche = {
  nom: string;
  modes: string[]; // ex. ["Métro"], ["Bus"] — tel que retourné par Navitia (commercial_mode.name)
  lignes: string[]; // ex. ["5", "9"]
  distanceMetres: number; // à vol d'oiseau, fourni par Navitia
};

export type StationVelibProche = {
  nom: string;
  distanceMetres: number; // à vol d'oiseau, calculé nous-mêmes (Haversine)
};

export type TransportsProximite = {
  arrets: ArretTransportProche[];
  source: "prim_idfm_navitia";
  recupereLe: string;
};

export type VelibProximite = {
  stations: StationVelibProche[];
  source: "velib_metropole_gbfs";
  recupereLe: string;
};
