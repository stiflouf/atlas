import { geocoderAdresse } from "./ignClient";
import { evaluerQualiteGeocodage } from "./qualite";
import type { Commune } from "@/types/geocodage";

// Résolution du code commune canonique d'un bien (ADR-035) — jamais bloquante pour l'enregistrement
// du bien : toute panne réseau/HTTP, réponse sans citycode, ou score insuffisant produit
// `undefined`, jamais une valeur approximative. Réutilise le même seuil de fiabilité que la
// préparation de visite (evaluerQualiteGeocodage, score >= 0.8, SEUIL_FIABLE) pour ne jamais avoir
// deux définitions différentes de "adresse fiable" dans le code. Appelée à chaque création ET à
// chaque modification d'un bien (jamais seulement si l'adresse a changé) : la façon la plus sûre
// d'éviter qu'un citycode devienne périmé après une modification d'adresse est de toujours
// recalculer depuis l'adresse actuelle plutôt que de détecter un changement — voir ADR-035.
export async function resoudreCommuneBien(
  adresse: string,
  ville: string,
  codePostal: string
): Promise<Commune | undefined> {
  const resultat = await geocoderAdresse(`${adresse}, ${codePostal} ${ville}`);
  if (!resultat || !resultat.commune) return undefined;
  if (evaluerQualiteGeocodage(resultat.score) !== "fiable") return undefined;
  return resultat.commune;
}
