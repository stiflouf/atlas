import type { Coordonnees } from "@/types/geocodage";
import type { CommercesProximite, PoiProche } from "@/types/commerces";
import { distanceHaversineMetres } from "@/lib/geo/distance";

const ENDPOINT = "https://overpass-api.de/api/interpreter";
const RAYON_METRES = 600;
const MAX_PAR_CATEGORIE = 2;

type CategorieCle = Exclude<keyof CommercesProximite, "source" | "recupereLe">;

// Un filtre par ligne de requête Overpass QL ; la catégorie est retrouvée après coup à partir
// des tags de chaque élément (Overpass ne "marque" pas de quel filtre vient un résultat).
const FILTRES: { tag: string; valeur: string }[] = [
  { tag: "shop", valeur: "supermarket" },
  { tag: "shop", valeur: "convenience" },
  { tag: "shop", valeur: "bakery" },
  { tag: "amenity", valeur: "pharmacy" },
  { tag: "amenity", valeur: "marketplace" },
  { tag: "leisure", valeur: "park" },
  { tag: "leisure", valeur: "garden" },
  { tag: "leisure", valeur: "sports_centre" },
  { tag: "leisure", valeur: "fitness_centre" },
  { tag: "amenity", valeur: "doctors" },
  { tag: "amenity", valeur: "clinic" },
  { tag: "amenity", valeur: "restaurant" },
  { tag: "amenity", valeur: "cafe" },
];

function categoriser(tags: Record<string, string>): CategorieCle | undefined {
  if (tags.shop === "supermarket" || tags.shop === "convenience") return "alimentation";
  if (tags.shop === "bakery") return "boulangeries";
  if (tags.amenity === "pharmacy") return "pharmacies";
  if (tags.amenity === "marketplace") return "marches";
  if (tags.leisure === "park" || tags.leisure === "garden") return "parcs";
  if (tags.leisure === "sports_centre" || tags.leisure === "fitness_centre") return "sport";
  if (tags.amenity === "doctors" || tags.amenity === "clinic") return "sante";
  if (tags.amenity === "restaurant" || tags.amenity === "cafe") return "restaurants";
  return undefined;
}

type ElementOverpass = {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

// Commerces et services autour d'un point, via Overpass (OpenStreetMap). Une seule requête
// combinant toutes les catégories. Les POI sans nom sont exclus (pas d'information utile pour
// le conseiller). Les restaurants/cafés sont récupérés mais non exposés à l'affichage pour
// l'instant — laissé au type CommercesProximite pour un usage futur.
export async function rechercherCommercesProches(coordonnees: Coordonnees): Promise<CommercesProximite | undefined> {
  const clauses = FILTRES.map(
    ({ tag, valeur }) => `nwr["${tag}"="${valeur}"](around:${RAYON_METRES},${coordonnees.lat},${coordonnees.lon});`
  ).join("\n  ");
  const requete = `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout center tags;`;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      // Overpass (Apache) répond 406 aux requêtes sans User-Agent explicite.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "AtlasCRM/1.0 (usage interne agence immobilière)",
      },
      body: `data=${encodeURIComponent(requete)}`,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[commerces] Overpass : ${res.status}`);
      return undefined;
    }

    const data = (await res.json()) as { elements: ElementOverpass[] };
    const parCategorie: Record<CategorieCle, (PoiProche & { categorie: CategorieCle })[]> = {
      alimentation: [],
      boulangeries: [],
      pharmacies: [],
      marches: [],
      parcs: [],
      sport: [],
      sante: [],
      restaurants: [],
    };

    for (const el of data.elements) {
      const tags = el.tags;
      const nom = tags?.name;
      if (!tags || !nom) continue;

      const categorie = categoriser(tags);
      if (!categorie) continue;

      const point = el.type === "node" ? { lat: el.lat!, lon: el.lon! } : el.center;
      if (!point) continue;

      const distanceMetres = Math.round(distanceHaversineMetres(coordonnees, point));
      if (distanceMetres > RAYON_METRES) continue;

      const detail = categorie === "restaurants" ? tags.cuisine?.split(";")[0] : undefined;
      parCategorie[categorie].push({ nom, distanceMetres, detail, categorie });
    }

    // OSM modélise parfois un même lieu à la fois en nœud et en polygone (ex. un parc) : on ne
    // garde que l'occurrence la plus proche par nom pour éviter les doublons à l'affichage.
    const dedupliquerParNom = (items: (PoiProche & { categorie: CategorieCle })[]) => {
      const parNom = new Map<string, PoiProche & { categorie: CategorieCle }>();
      for (const item of items) {
        const existant = parNom.get(item.nom);
        if (!existant || item.distanceMetres < existant.distanceMetres) parNom.set(item.nom, item);
      }
      return [...parNom.values()];
    };

    const finalise = (categorie: CategorieCle): PoiProche[] =>
      dedupliquerParNom(parCategorie[categorie])
        .sort((a, b) => a.distanceMetres - b.distanceMetres)
        .slice(0, MAX_PAR_CATEGORIE)
        .map(({ nom, distanceMetres, detail }) => ({ nom, distanceMetres, detail }));

    return {
      alimentation: finalise("alimentation"),
      boulangeries: finalise("boulangeries"),
      pharmacies: finalise("pharmacies"),
      marches: finalise("marches"),
      parcs: finalise("parcs"),
      sport: finalise("sport"),
      sante: finalise("sante"),
      restaurants: finalise("restaurants"),
      source: "openstreetmap_overpass",
      recupereLe: new Date().toISOString(),
    };
  } catch (erreur) {
    console.error("[commerces] appel Overpass échoué :", erreur);
    return undefined;
  }
}
