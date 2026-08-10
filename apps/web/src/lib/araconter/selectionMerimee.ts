import type { MonumentProche } from "@/types/patrimoine";
import type { ElementARaconter } from "@/types/araconter";

const MAX_ELEMENTS = 3;
const MAX_PHRASES_PAR_ELEMENT = 3;
const REGEX_ANNEE = /\b1[4-9]\d{2}\b|\b20\d{2}\b/;

// Aucun LLM, aucune reformulation : on ne retient que les phrases du texte officiel qui
// contiennent une date explicite (proxy générique pour « fait racontable pendant une visite »),
// dans leur ordre et leur formulation d'origine.
function phrasesDatees(texteComplet: string, max: number): string {
  const phrases = (texteComplet.match(/[^.!?]*[.!?]+/g) ?? []).map((p) => p.trim());
  return phrases.filter((p) => REGEX_ANNEE.test(p)).slice(0, max).join(" ");
}

// Détecte les notices dont le texte officiel est quasi identique (ex. plusieurs accès de métro
// Guimard partagent le même paragraphe type) pour éviter de raconter deux fois la même chose.
function normaliser(texte: string): string {
  return texte.toLowerCase().replace(/[^a-zà-ÿ0-9]+/g, " ").trim();
}

function estDoublonTextuel(a: string, b: string): boolean {
  const longueur = 150;
  return normaliser(a).slice(0, longueur) === normaliser(b).slice(0, longueur);
}

// Sélectionne, parmi les monuments Mérimée déjà trouvés à proximité, jusqu'à 3 éléments dont le
// texte officiel contient une information datée exploitable pour une visite — sans jamais ajouter
// ni reformuler d'information absente de la source.
export function selectionnerElementsARaconter(
  monuments: MonumentProche[],
  source: string,
  recupereLe: string
): ElementARaconter[] {
  const retenus: ElementARaconter[] = [];
  const historiquesRetenus: string[] = [];

  for (const monument of [...monuments].sort((a, b) => a.distanceMetres - b.distanceMetres)) {
    if (retenus.length >= MAX_ELEMENTS) break;
    if (!monument.historiqueComplet) continue;
    if (historiquesRetenus.some((h) => estDoublonTextuel(h, monument.historiqueComplet!))) continue;

    const texte = phrasesDatees(monument.historiqueComplet, MAX_PHRASES_PAR_ELEMENT);
    if (!texte) continue;

    retenus.push({
      nature: "fait_historique",
      titre: monument.nom,
      texte,
      distanceMetres: monument.distanceMetres,
      reference: monument.reference,
      source,
      recupereLe,
    });
    historiquesRetenus.push(monument.historiqueComplet);
  }

  return retenus;
}
