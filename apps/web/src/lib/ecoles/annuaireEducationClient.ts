import type { Coordonnees } from "@/types/geocodage";
import type { EtablissementProche, EcolesProximite } from "@/types/ecoles";
import { distanceHaversineMetres } from "@/lib/geo/distance";

const ENDPOINT =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records";
const RAYON_METRES = 800;
const MAX_PAR_NIVEAU = 3;

type RecordAnnuaire = {
  nom_etablissement: string;
  type_etablissement: string;
  statut_public_prive: string | null;
  position: { lat: number; lon: number } | null;
};
type ReponseAnnuaire = { results: RecordAnnuaire[] };

function statutDepuisSource(statut: string | null): "Public" | "Privé" | undefined {
  return statut === "Public" || statut === "Privé" ? statut : undefined;
}

// Établissements scolaires autour d'un point, via l'Annuaire de l'Éducation Nationale
// (data.education.gouv.fr). Aucune notation ni niveau (maternelle/élémentaire) déduits — la
// source ne les fournit pas de façon fiable pour tous les établissements, donc on ne les
// invente pas. "Ecole" (source) est affiché "École" (typographie), sans autre reformulation.
export async function rechercherEcolesProches(coordonnees: Coordonnees): Promise<EcolesProximite | undefined> {
  const where = `within_distance(position,geom'POINT(${coordonnees.lon} ${coordonnees.lat})',${RAYON_METRES}m) and etat='OUVERT'`;
  const url = `${ENDPOINT}?${new URLSearchParams({ where, limit: "100" })}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[ecoles] annuaire éducation : ${res.status}`);
      return undefined;
    }

    const data = (await res.json()) as ReponseAnnuaire;
    const avecDistance = data.results
      .filter((r): r is RecordAnnuaire & { position: { lat: number; lon: number } } => Boolean(r.position))
      .map((r) => ({
        nom: r.nom_etablissement,
        statut: statutDepuisSource(r.statut_public_prive),
        distanceMetres: Math.round(distanceHaversineMetres(coordonnees, r.position)),
        type: r.type_etablissement,
      }))
      .sort((a, b) => a.distanceMetres - b.distanceMetres);

    const parType = (type: string): EtablissementProche[] =>
      avecDistance
        .filter((e) => e.type === type)
        .slice(0, MAX_PAR_NIVEAU)
        .map(({ nom, statut, distanceMetres }) => ({ nom, statut, distanceMetres }));

    return {
      ecoles: parType("Ecole"),
      colleges: parType("Collège"),
      lycees: parType("Lycée"),
      source: "annuaire_education_nationale",
      recupereLe: new Date().toISOString(),
    };
  } catch (erreur) {
    console.error("[ecoles] appel annuaire éducation échoué :", erreur);
    return undefined;
  }
}
