import type { ResultatGeocodage } from "@/types/geocodage";

const ENDPOINT = "https://data.geopf.fr/geocodage/search";

type FeatureAdresse = {
  geometry: { coordinates: [number, number] };
  properties: { score: number; label: string };
};

type ReponseGeocodage = { features: FeatureAdresse[] };

// Géocode une adresse via la Géoplateforme IGN (BAN). Aucune clé requise en usage anonyme.
// Le score n'est jamais filtré ici : une adresse mal reconnue renvoie quand même un candidat,
// avec un score faible — c'est à l'appelant de décider quoi en faire. Seule l'absence totale
// de résultat (ou une erreur réseau/HTTP) est traitée comme un échec, sans coordonnée de repli.
export async function geocoderAdresse(adresse: string): Promise<ResultatGeocodage | undefined> {
  const url = `${ENDPOINT}?${new URLSearchParams({ q: adresse, limit: "1" })}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[geocodage] IGN Géoplateforme : ${res.status}`);
      return undefined;
    }

    const data = (await res.json()) as ReponseGeocodage;
    const feature = data.features[0];
    if (!feature) return undefined;

    const [lon, lat] = feature.geometry.coordinates;
    return {
      coordonnees: { lat, lon },
      score: feature.properties.score,
      labelTrouve: feature.properties.label,
      source: "ign_geoplateforme",
      recupereLe: new Date().toISOString(),
    };
  } catch (erreur) {
    console.error("[geocodage] appel IGN Géoplateforme échoué :", erreur);
    return undefined;
  }
}
