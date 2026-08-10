import type { Coordonnees } from "@/types/geocodage";
import type { StationVelibProche, VelibProximite } from "@/types/transports";
import { distanceHaversineMetres } from "@/lib/geo/distance";

const STATIONS_URL = "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json";
const RAYON_METRES = 500;

type StationGbfs = { name: string; lat: number; lon: number };
type ReponseGbfs = { data: { stations: StationGbfs[] } };

// Stations Vélib' autour d'un point, via le flux GBFS officiel de Vélib' Métropole — standard
// ouvert, gratuit, sans clé. Le fichier liste toutes les stations (~1500) sans recherche par
// point : la distance est calculée nous-mêmes (à vol d'oiseau) et filtrée par rayon.
export async function rechercherVelibProches(coordonnees: Coordonnees): Promise<VelibProximite | undefined> {
  try {
    const res = await fetch(STATIONS_URL, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[velib] GBFS Vélib' Métropole : ${res.status}`);
      return undefined;
    }

    const data = (await res.json()) as ReponseGbfs;
    const stations: StationVelibProche[] = data.data.stations
      .map((s) => ({ nom: s.name, distanceMetres: Math.round(distanceHaversineMetres(coordonnees, { lat: s.lat, lon: s.lon })) }))
      .filter((s) => s.distanceMetres <= RAYON_METRES)
      .sort((a, b) => a.distanceMetres - b.distanceMetres);

    return { stations, source: "velib_metropole_gbfs", recupereLe: new Date().toISOString() };
  } catch (erreur) {
    console.error("[velib] appel GBFS Vélib' Métropole échoué :", erreur);
    return undefined;
  }
}
