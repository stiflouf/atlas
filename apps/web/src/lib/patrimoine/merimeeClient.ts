import type { Coordonnees } from "@/types/geocodage";
import type { MonumentProche, PatrimoineProximite } from "@/types/patrimoine";
import { distanceHaversineMetres } from "@/lib/geo/distance";

// API tabulaire générique de data.gouv.fr, générée sur le CSV officiel de la base Mérimée
// (Ministère de la Culture, dataset "Immeubles protégés au titre des Monuments Historiques").
const RESOURCE_ID = "3a52af4a-f9da-4dcc-8110-b07774dfb3bc";
const ENDPOINT = `https://tabular-api.data.gouv.fr/api/resources/${RESOURCE_ID}/data/`;
const PAGE_SIZE = 200;
const RAYON_METRES = 500;
const MAX_RESULTATS = 5;
const EXTRAIT_MAX_CARACTERES = 400;
const EXTRAIT_MAX_PHRASES = 3;

const COLONNES = [
  "Reference",
  "Titre_editorial_de_la_notice",
  "Denomination_de_l_edifice",
  "coordonnees_au_format_WGS84",
  "Historique",
].join(",");

type LigneMerimee = {
  Reference: string | null;
  Titre_editorial_de_la_notice: string | null;
  Denomination_de_l_edifice: string | null;
  coordonnees_au_format_WGS84: string | null;
  Historique: string | null;
};

type ReponseTabulaire = {
  data: LigneMerimee[];
  meta: { page: number; page_size: number; total: number };
};

// L'API ne filtre pas par rayon ; on réduit d'abord par département (dérivé du code postal du
// bien), puis on calcule la distance côté serveur sur les lignes renvoyées. La Corse (2A/2B)
// n'est pas gérée par ce préfixe à 2 chiffres — non bloquant tant qu'aucun bien n'y est traité.
function codeDepartement(codePostal: string): string {
  if (codePostal.startsWith("97") || codePostal.startsWith("98")) return codePostal.slice(0, 3);
  return codePostal.slice(0, 2);
}

// Nettoyage typographique minimal des textes officiels Mérimée : espaces multiples, espaces
// avant virgule/point, guillemets droits reconvertis en guillemets français uniquement quand une
// paire est clairement identifiable (nombre pair de guillemets). Ne touche jamais au contenu :
// aucun mot ajouté, supprimé ou reformulé.
function nettoyerTypographie(texte: string): string {
  let t = texte.replace(/\s+/g, " ").trim();

  // Certains textes Mérimée imbriquent des guillemets (ex. tout le champ entre guillemets, avec
  // un terme lui-même entre guillemets à l'intérieur) — un appariement séquentiel naïf inverserait
  // alors l'ouverture/fermeture. On ne convertit donc que les paires non ambiguës : exactement
  // deux guillemets droits dans tout le texte.
  const nbGuillemets = (t.match(/"/g) ?? []).length;
  if (nbGuillemets === 2) {
    t = t.replace(/"\s*([^"]*?)\s*"/, "« $1 »");
  }

  return t.replace(/\s+([,.])/g, "$1");
}

// Tronque le texte officiel à ~400 caractères / 3 phrases maximum, sans reformuler. Ajoute des
// points de suspension uniquement si une coupure a réellement eu lieu.
function extraireResume(texteComplet: string): string {
  const fenetre = texteComplet.slice(0, EXTRAIT_MAX_CARACTERES);
  const phrases = fenetre.match(/[^.!?]*[.!?]+/g) ?? [];
  const resume = phrases.slice(0, EXTRAIT_MAX_PHRASES).join("").trim() || fenetre.trim();
  return resume.length < texteComplet.trim().length ? `${resume} …` : resume;
}

async function recupererPage(departement: string, page: number): Promise<ReponseTabulaire | undefined> {
  const params = new URLSearchParams({
    Departement_format_numerique__exact: departement,
    page_size: String(PAGE_SIZE),
    page: String(page),
    columns: COLONNES,
  });
  const res = await fetch(`${ENDPOINT}?${params}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`[patrimoine] API tabulaire data.gouv.fr : ${res.status}`);
    return undefined;
  }
  return (await res.json()) as ReponseTabulaire;
}

// Monuments historiques protégés à proximité d'un point, via la base Mérimée (data.gouv.fr).
// Best-effort : aucune donnée de repli si l'API ne répond pas.
export async function rechercherPatrimoineProche(
  coordonnees: Coordonnees,
  codePostal: string
): Promise<PatrimoineProximite | undefined> {
  try {
    const departement = codeDepartement(codePostal);
    const premierePage = await recupererPage(departement, 1);
    if (!premierePage) return undefined;

    const nbPages = Math.ceil(premierePage.meta.total / PAGE_SIZE);
    const pagesSuivantes =
      nbPages > 1
        ? await Promise.all(
            Array.from({ length: nbPages - 1 }, (_, i) => recupererPage(departement, i + 2))
          )
        : [];

    const lignes = [premierePage, ...pagesSuivantes]
      .filter((p): p is ReponseTabulaire => p !== undefined)
      .flatMap((p) => p.data);

    const monuments: MonumentProche[] = [];
    for (const ligne of lignes) {
      const nomBrut = ligne.Titre_editorial_de_la_notice?.trim();
      if (!ligne.Reference || !nomBrut || !ligne.coordonnees_au_format_WGS84) continue;
      const nom = nettoyerTypographie(nomBrut);

      const [latStr, lonStr] = ligne.coordonnees_au_format_WGS84.split(",");
      const lat = Number(latStr);
      const lon = Number(lonStr);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const distanceMetres = Math.round(distanceHaversineMetres(coordonnees, { lat, lon }));
      if (distanceMetres > RAYON_METRES) continue;

      const historique = ligne.Historique?.trim() ? nettoyerTypographie(ligne.Historique) : undefined;
      monuments.push({
        reference: ligne.Reference,
        nom,
        type: ligne.Denomination_de_l_edifice?.split(";")[0]?.trim() || undefined,
        distanceMetres,
        extraitHistorique: historique ? extraireResume(historique) : undefined,
        historiqueComplet: historique || undefined,
      });
    }

    monuments.sort((a, b) => a.distanceMetres - b.distanceMetres);

    return {
      monuments: monuments.slice(0, MAX_RESULTATS),
      source: "data_gouv_fr_base_merimee",
      recupereLe: new Date().toISOString(),
    };
  } catch (erreur) {
    console.error("[patrimoine] appel API tabulaire échoué :", erreur);
    return undefined;
  }
}
