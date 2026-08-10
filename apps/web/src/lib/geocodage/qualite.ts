import type { QualiteGeocodage } from "@/types/geocodage";

// Un score IGN ne certifie jamais "c'est la bonne adresse" — il indique juste la confiance dans
// le meilleur candidat trouvé. En dessous de ces seuils, Atlas ne doit pas exploiter la
// localisation comme si elle était acquise (ni l'afficher comme fiable, ni s'en servir pour de
// futurs enrichissements géographiques).
export const SEUIL_FIABLE = 0.8;
export const SEUIL_A_VERIFIER = 0.5;

export function evaluerQualiteGeocodage(score: number): QualiteGeocodage {
  if (score >= SEUIL_FIABLE) return "fiable";
  if (score >= SEUIL_A_VERIFIER) return "a_verifier";
  return "insuffisant";
}
