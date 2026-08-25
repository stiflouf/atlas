import { createHash } from "node:crypto";
import sharp from "sharp";

// Traitement image d'une photo de bien (ADR-052) — décodage RÉEL via Sharp, jamais une confiance
// dans file.type (falsifiable côté client). Un fichier qui n'est pas une image jpeg/png/webp
// authentique (corrompu, faux JPEG, format non supporté type HEIC/GIF/BMP) est rejeté ici, avant
// toute écriture disque.

export type TypeMimePhoto = "image/jpeg" | "image/png" | "image/webp";

export class ErreurPhotoInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurPhotoInvalide";
  }
}

const MIME_PAR_FORMAT_SHARP: Partial<Record<string, TypeMimePhoto>> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

// Version d'affichage unique (ADR-052 §8) : orientation EXIF corrigée, fit inside 1600px sur le
// grand côté, jamais d'agrandissement, WebP qualité 75 — sert indifféremment hero/card/thumb via
// `fill` + `object-cover` côté composant, aucune génération de variantes multiples (pas de
// pipeline, pas de thumbnails séparés).
const DIMENSION_MAX_COTE = 1600;
const QUALITE_WEBP = 75;

export type PhotoTraitee = {
  // MIME canonique déduit du format réellement décodé — jamais celui déclaré par le client.
  typeMimeOriginal: TypeMimePhoto;
  hashSha256: string;
  bufferOptimise: Buffer;
};

// Lève ErreurPhotoInvalide si le contenu n'est pas une image jpeg/png/webp réellement décodable —
// jamais une exception Sharp brute qui remonterait telle quelle à l'appelant.
export async function traiterPhotoBien(original: Buffer): Promise<PhotoTraitee> {
  let metadata;
  try {
    metadata = await sharp(original).metadata();
  } catch {
    throw new ErreurPhotoInvalide("Fichier illisible : ce n'est pas une image valide.");
  }

  const typeMimeOriginal = metadata.format ? MIME_PAR_FORMAT_SHARP[metadata.format] : undefined;
  if (!typeMimeOriginal) {
    throw new ErreurPhotoInvalide(
      `Format d'image non supporté (${metadata.format ?? "inconnu"}) — jpeg, png ou webp uniquement.`
    );
  }

  let bufferOptimise: Buffer;
  try {
    bufferOptimise = await sharp(original)
      .rotate()
      .resize(DIMENSION_MAX_COTE, DIMENSION_MAX_COTE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITE_WEBP })
      .toBuffer();
  } catch {
    throw new ErreurPhotoInvalide("Fichier illisible : ce n'est pas une image valide.");
  }

  const hashSha256 = createHash("sha256").update(original).digest("hex");

  return { typeMimeOriginal, hashSha256, bufferOptimise };
}
