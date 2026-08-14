import type { Commune, ResultatGeocodage } from "@/types/geocodage";

const ENDPOINT = "https://data.geopf.fr/geocodage/search";

// Propriétés réellement présentes dans la réponse IGN/BAN (vérifié empiriquement, ADR-035) —
// citycode/postcode/city/context sont retournés aussi bien pour une adresse précise
// (type "housenumber"/"street") que pour une commune (type "municipality"), donc geocoderAdresse()
// et rechercherCommunes() partagent le même mapping de propriétés.
type PropertesAdresse = {
  score: number;
  label: string;
  citycode?: string;
  postcode?: string;
  city?: string;
  context?: string;
  type?: string;
};

type FeatureAdresse = {
  geometry: { coordinates: [number, number] };
  properties: PropertesAdresse;
};

type ReponseGeocodage = { features: FeatureAdresse[] };

// Paris/Lyon/Marseille sont les trois seules communes françaises légalement divisées en
// arrondissements municipaux (Code général des collectivités territoriales, art. L2511-1). L'IGN
// les expose comme une entrée "ville entière" distincte de chaque arrondissement (ex. Paris
// citycode 75056, à côté de Paris 10e arrondissement citycode 75110) — vérifié empiriquement.
// Cette entrée générique n'est JAMAIS retournée par rechercherCommunes() : la sélectionner
// laisserait croire à tort qu'elle couvre tous les arrondissements, ce qu'aucune donnée
// structurée ne permet d'affirmer (ADR-035, section 11). Liste fixe et documentée — jamais une
// heuristique sur le nom (un filtre par présence de banId a été envisagé puis écarté : vérifié
// empiriquement que certaines communes ordinaires, sans rapport avec Paris/Lyon/Marseille, en
// sont également dépourvues — ç'aurait exclu à tort des communes légitimes).
export const CODES_INSEE_VILLE_A_ARRONDISSEMENTS: ReadonlySet<string> = new Set(["75056", "69123", "13055"]);

function featureVersCommune(feature: FeatureAdresse): Commune | undefined {
  const { citycode, city, postcode, context } = feature.properties;
  if (!citycode || !city || !postcode) return undefined;
  return { citycode, nom: city, codePostal: postcode, contexte: context ?? "" };
}

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
      commune: featureVersCommune(feature),
      source: "ign_geoplateforme",
      recupereLe: new Date().toISOString(),
    };
  } catch (erreur) {
    console.error("[geocodage] appel IGN Géoplateforme échoué :", erreur);
    return undefined;
  }
}

// Recherche de communes/arrondissements par nom (ADR-035) — pour l'autocomplétion des secteurs de
// recherche acquéreur, jamais pour résoudre un bien (voir geocoderAdresse). `type=municipality`
// restreint aux entités commune/arrondissement de l'IGN. Exclut systématiquement les trois entrées
// génériques Paris/Lyon/Marseille (voir CODES_INSEE_VILLE_A_ARRONDISSEMENTS). Retourne un tableau
// vide en cas d'échec réseau/HTTP — jamais d'exception, l'appelant (recherche interactive) doit
// pouvoir afficher "aucun résultat" sans distinguer une panne d'une recherche vide.
export async function rechercherCommunes(recherche: string): Promise<Commune[]> {
  const texte = recherche.trim();
  if (texte === "") return [];

  const url = `${ENDPOINT}?${new URLSearchParams({ q: texte, type: "municipality", limit: "10" })}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[geocodage] recherche commune IGN : ${res.status}`);
      return [];
    }

    const data = (await res.json()) as ReponseGeocodage;
    const communes: Commune[] = [];
    for (const feature of data.features) {
      const commune = featureVersCommune(feature);
      if (commune && !CODES_INSEE_VILLE_A_ARRONDISSEMENTS.has(commune.citycode)) {
        communes.push(commune);
      }
    }
    return communes;
  } catch (erreur) {
    console.error("[geocodage] recherche commune IGN échouée :", erreur);
    return [];
  }
}

// Re-vérification serveur (ADR-035, section 8) : une Server Action ne doit jamais persister un
// citycode/nom/codePostal soumis tels quels par le client (trois hidden inputs manipulables).
// Cette fonction rejoue une recherche IGN filtrée par citycode et ne retourne un résultat que si
// l'IGN confirme, à cet instant, l'existence d'une commune portant exactement ce citycode — les
// valeurs persistées sont TOUJOURS celles renvoyées par cette vérification fraîche, jamais celles
// soumises par le client. Retourne undefined si l'IGN est indisponible, ambigu, ou si le citycode
// soumis n'est confirmé par aucun résultat — jamais une acceptation par défaut.
export async function verifierCommune(citycode: string, nomSoumis: string): Promise<Commune | undefined> {
  const texte = nomSoumis.trim();
  if (texte === "" || citycode.trim() === "") return undefined;

  const url = `${ENDPOINT}?${new URLSearchParams({ q: texte, citycode, type: "municipality", limit: "1" })}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[geocodage] vérification commune IGN : ${res.status}`);
      return undefined;
    }

    const data = (await res.json()) as ReponseGeocodage;
    const feature = data.features[0];
    if (!feature) return undefined;

    const commune = featureVersCommune(feature);
    if (!commune || commune.citycode !== citycode) return undefined;
    return commune;
  } catch (erreur) {
    console.error("[geocodage] vérification commune IGN échouée :", erreur);
    return undefined;
  }
}
