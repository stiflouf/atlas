import type { Coordonnees } from "@/types/geocodage";
import type { TypeBien } from "@/types/bien";
import type { MarcheProximite, TransactionComparable } from "@/types/marche";
import { distanceHaversineMetres } from "@/lib/geo/distance";

// API Données foncières du Cerema/DGALN (DVF+ open-data, retraitement géolocalisé de la donnée
// DGFiP). Hébergée en préprod par le Cerema lui-même — testée fiable en usage réel mais sans
// garantie de disponibilité ; d'où le comportement best-effort strict de ce client.
const ENDPOINT = "https://apidf-preprod.cerema.fr/dvf_opendata/geomutations/";
const RAYON_METRES = 500;
const MOIS_PERIODE = 24;
const PRIX_M2_MIN = 1500;
const PRIX_M2_MAX = 25000;
const MAX_RESULTATS = 5;
const MIN_RESULTATS_AVANT_ELARGISSEMENT = 3;
const TOLERANCES_SURFACE = [0.25, 0.35, 0.45, 0.6, 0.8, 1.0];
const PAGE_SIZE = 500;
const MAX_PAGES = 8;

// La donnée ne distingue pas studio/loft d'un appartement classique ; la tolérance de surface
// s'occupe déjà de la comparabilité par taille. "UNE MAISON" suit la même convention de
// libellé que "UN APPARTEMENT" (seul confirmé en test réel) — à vérifier avant un premier bien
// de type maison. local_commercial n'a pas de correspondance fiable identifiée : on n'interroge
// pas DVF dans ce cas plutôt que de deviner.
function libTypBienDVF(type: TypeBien): string | undefined {
  switch (type) {
    case "appartement":
    case "studio":
    case "loft":
      return "UN APPARTEMENT";
    case "maison":
      return "UNE MAISON";
    default:
      return undefined;
  }
}

// Rectangle englobant un rayon donné autour d'un point — approximation locale suffisante à
// l'échelle d'un quartier (mêmes ordres de grandeur que pour les autres sources géo du projet).
function bbox(coordonnees: Coordonnees, rayonMetres: number): string {
  const dLat = rayonMetres / 111320;
  const dLon = rayonMetres / (111320 * Math.cos((coordonnees.lat * Math.PI) / 180));
  return [
    coordonnees.lon - dLon,
    coordonnees.lat - dLat,
    coordonnees.lon + dLon,
    coordonnees.lat + dLat,
  ].join(",");
}

// Centroïde approximatif d'une géométrie Polygon/MultiPolygon GeoJSON — suffisant pour une
// distance à vol d'oiseau, pas pour un usage cadastral précis.
function centroide(geometry: { coordinates: unknown }): Coordonnees {
  const points: [number, number][] = [];
  const collecter = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number") {
      points.push(node as [number, number]);
    } else if (Array.isArray(node)) {
      node.forEach(collecter);
    }
  };
  collecter(geometry.coordinates);
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const lon = points.reduce((s, p) => s + p[0], 0) / points.length;
  return { lat, lon };
}

type FeatureMutation = {
  properties: {
    datemut: string;
    libnatmut: string;
    libtypbien: string;
    valeurfonc: string;
    sbati: string;
    idopendata: string;
  };
  geometry: { coordinates: unknown };
};

type ReponseGeoJSON = {
  count: number;
  features: FeatureMutation[];
};

async function recupererPage(params: URLSearchParams): Promise<ReponseGeoJSON | undefined> {
  const res = await fetch(`${ENDPOINT}?${params}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`[marche] API Données foncières : ${res.status}`);
    return undefined;
  }
  return (await res.json()) as ReponseGeoJSON;
}

// Transactions de vente comparables à proximité, via l'API Données foncières (DVF+ open-data).
// Best-effort strict : aucun repli sur des données mockées si l'API ne répond pas.
export async function rechercherTransactionsComparables(
  coordonnees: Coordonnees,
  typeBien: TypeBien,
  surfaceBien: number
): Promise<MarcheProximite | undefined> {
  const libTypBien = libTypBienDVF(typeBien);
  if (!libTypBien) return undefined;

  try {
    // Fenêtre calée sur des années civiles pour rester à un seul paramètre simple ; couvre les
    // ~24 derniers mois disponibles sans requête préalable pour trouver la date la plus récente.
    const anneeMin = new Date().getFullYear() - Math.ceil(MOIS_PERIODE / 12);

    const baseParams = {
      in_bbox: bbox(coordonnees, RAYON_METRES),
      libnatmut: "Vente",
      anneemut_min: String(anneeMin),
      page_size: String(PAGE_SIZE),
    };

    const premierePage = await recupererPage(new URLSearchParams({ ...baseParams, page: "1" }));
    if (!premierePage) return undefined;

    const nbPages = Math.min(Math.ceil(premierePage.count / PAGE_SIZE), MAX_PAGES);
    const pagesSuivantes =
      nbPages > 1
        ? await Promise.all(
            Array.from({ length: nbPages - 1 }, (_, i) =>
              recupererPage(new URLSearchParams({ ...baseParams, page: String(i + 2) }))
            )
          )
        : [];

    const features = [premierePage, ...pagesSuivantes]
      .filter((p): p is ReponseGeoJSON => p !== undefined)
      .flatMap((p) => p.features);

    const candidats: TransactionComparable[] = [];
    for (const feature of features) {
      const props = feature.properties;
      if (props.libnatmut !== "Vente") continue;
      if (props.libtypbien !== libTypBien) continue;

      const prixVente = Number(props.valeurfonc);
      const surfaceM2 = Number(props.sbati);
      if (!Number.isFinite(prixVente) || !Number.isFinite(surfaceM2) || surfaceM2 <= 0) continue;

      const prixM2 = prixVente / surfaceM2;
      if (prixM2 < PRIX_M2_MIN || prixM2 > PRIX_M2_MAX) continue;

      const distanceMetres = Math.round(distanceHaversineMetres(coordonnees, centroide(feature.geometry)));
      if (distanceMetres > RAYON_METRES) continue;

      candidats.push({
        dateVente: props.datemut,
        prixVente,
        surfaceM2,
        prixM2: Math.round(prixM2),
        distanceMetres,
        reference: props.idopendata,
      });
    }

    // Tolérance de surface élargie progressivement tant qu'on a moins de 3 comparables — jamais
    // pour en inventer, seulement pour agrandir la fenêtre de recherche réelle.
    let retenus: TransactionComparable[] = [];
    for (const tolerance of TOLERANCES_SURFACE) {
      const min = surfaceBien * (1 - tolerance);
      const max = surfaceBien * (1 + tolerance);
      retenus = candidats.filter((c) => c.surfaceM2 >= min && c.surfaceM2 <= max);
      if (retenus.length >= MIN_RESULTATS_AVANT_ELARGISSEMENT) break;
    }

    retenus.sort((a, b) => {
      const ecartA = Math.abs(a.surfaceM2 - surfaceBien);
      const ecartB = Math.abs(b.surfaceM2 - surfaceBien);
      return ecartA !== ecartB ? ecartA - ecartB : a.distanceMetres - b.distanceMetres;
    });

    return {
      transactions: retenus.slice(0, MAX_RESULTATS),
      source: "Cerema — API Données foncières (DVF+ open-data)",
      recupereLe: new Date().toISOString(),
    };
  } catch (erreur) {
    console.error("[marche] appel API Données foncières échoué :", erreur);
    return undefined;
  }
}
