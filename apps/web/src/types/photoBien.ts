// Galerie photo réelle d'un bien (ADR-052). cleStockage n'est jamais exposée hors du serveur — le
// front ne reçoit que des id (voir photoBienRepository.ts, l'API /api/photos-bien/[photoId] et
// BienAvecPhotoPrincipale dans bienRepository.ts).
export type PhotoBien = {
  id: string;
  bienId: string;
  cleStockage: string;
  nomFichierOriginal: string;
  typeMimeOriginal: string;
  tailleOctetsOriginal: number;
  hashSha256: string;
  ordre: number;
  creeLe: string;
};

// Limites pilotables V1 (ADR-052) — constantes de code, jamais des contraintes SQL rigides : ADR
// discutée mais ajustable sans migration.
export const TAILLE_MAX_PHOTO_OCTETS = 12 * 1024 * 1024;
export const NOMBRE_MAX_PHOTOS_PAR_BIEN = 20;
export const TYPES_MIME_PHOTO_AUTORISES = ["image/jpeg", "image/png", "image/webp"] as const;
