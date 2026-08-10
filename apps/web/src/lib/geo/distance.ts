import type { Coordonnees } from "@/types/geocodage";

const RAYON_TERRE_METRES = 6371000;

// Distance à vol d'oiseau entre deux points (formule de Haversine) — jamais un temps de
// marche, jamais un itinéraire : juste la distance géométrique en mètres.
export function distanceHaversineMetres(a: Coordonnees, b: Coordonnees): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE_METRES * Math.asin(Math.sqrt(h));
}
