import type { Coordonnees } from "@/types/geocodage";
import type { ArretTransportProche, TransportsProximite } from "@/types/transports";
import { RAYON_METRES_TRANSPORTS as RAYON_METRES } from "./constantes";

const BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia";
const COVERAGE = "idfm";

type LigneNavitia = { code?: string; commercial_mode?: { name?: string } };
type StopAreaNavitia = { name: string; lines?: LigneNavitia[]; commercial_modes?: { name: string }[] };
type PlaceNearbyNavitia = { embedded_type: string; distance: string; stop_area?: StopAreaNavitia };
type ReponseNavitia = { places_nearby: PlaceNearbyNavitia[] };

// Arrêts de transport en commun autour d'un point, via l'API Navitia de PRIM (Île-de-France
// Mobilités) — couverture limitée à l'Île-de-France. depth=3 est nécessaire pour que les lignes
// soient présentes dans stop_area.lines. La distance retournée par Navitia est à vol d'oiseau.
export async function rechercherArretsProches(
  coordonnees: Coordonnees
): Promise<TransportsProximite | undefined> {
  const cle = process.env.PRIM_API_KEY;
  if (!cle) {
    console.error("[transports] PRIM_API_KEY absente");
    return undefined;
  }

  const params = new URLSearchParams({
    distance: String(RAYON_METRES),
    depth: "3",
    disable_geojson: "true",
    disable_disruption: "true",
  });
  params.append("type[]", "stop_area");
  const url = `${BASE_URL}/coverage/${COVERAGE}/coord/${coordonnees.lon};${coordonnees.lat}/places_nearby?${params}`;

  try {
    const res = await fetch(url, { headers: { apiKey: cle }, cache: "no-store" });
    if (!res.ok) {
      console.error(`[transports] PRIM Navitia : ${res.status}`);
      return undefined;
    }

    const data = (await res.json()) as ReponseNavitia;
    const arrets: ArretTransportProche[] = data.places_nearby
      .filter((p): p is PlaceNearbyNavitia & { stop_area: StopAreaNavitia } => Boolean(p.stop_area))
      .map((p) => ({
        nom: p.stop_area.name,
        modes: (p.stop_area.commercial_modes ?? []).map((m) => m.name),
        lignes: (p.stop_area.lines ?? []).map((l) => l.code).filter((c): c is string => Boolean(c)),
        distanceMetres: Math.round(Number(p.distance)),
      }))
      .sort((a, b) => a.distanceMetres - b.distanceMetres);

    return { arrets, source: "prim_idfm_navitia", recupereLe: new Date().toISOString() };
  } catch (erreur) {
    console.error("[transports] appel PRIM Navitia échoué :", erreur);
    return undefined;
  }
}
