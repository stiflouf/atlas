import sharp from "sharp";

// V1 : le canvas client (SignatureCanvas.tsx) exporte toujours un PNG via `canvas.toDataURL()`,
// fond TRANSPARENT (jamais rempli) — c'est ce qui permet de distinguer un canvas jamais touché
// (entièrement transparent) d'un trait réellement dessiné (§29 du brief : "ne pas se contenter de
// vérifier chaîne non vide côté client").
export const PREFIXE_DATA_URL_PNG = "data:image/png;base64,";

// Une signature manuscrite tient en quelques dizaines de Ko ; 2 Mo est déjà une marge large pour
// un canvas haute résolution — au-delà, refus contrôlé plutôt qu'un data URL gigantesque en DB/FormData
// (§43).
export const TAILLE_MAX_SIGNATURE_OCTETS = 2 * 1024 * 1024;

export type ResultatEmptinessSignature = "vide" | "non_vide" | "format_invalide";

// Extrait pour être appelé DEUX FOIS indépendamment (§29/§44, défense en profondeur) : une fois ici
// (validerEtDecoderSignatureImage, côté Server Action) et une seconde fois directement par
// signerBonVisite (bonVisiteRepository.ts) sur le buffer qu'on lui passe — jamais un writer qui
// fait confiance à la validation déjà faite par son appelant.
export async function bufferSignatureEstVide(buffer: Buffer): Promise<ResultatEmptinessSignature> {
  let canalAlpha;
  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.format !== "png") return "format_invalide";
    const stats = await sharp(buffer).stats();
    canalAlpha = stats.channels[3];
  } catch {
    return "format_invalide";
  }
  // Pas de canal alpha exploitable : ne correspond pas à l'export attendu du canvas — refusé plutôt
  // que supposé "signé".
  if (!canalAlpha) return "format_invalide";
  return canalAlpha.max === 0 ? "vide" : "non_vide";
}

export type ResultatValidationSignature =
  | { statut: "valide"; buffer: Buffer }
  | { statut: "absente" }
  | { statut: "format_invalide" }
  | { statut: "trop_grande" }
  | { statut: "vide" };

// Ne fait jamais confiance au type MIME déclaré par le client (§44) : le préfixe du data URL est
// vérifié strictement, ET le buffer décodé doit réellement parser comme un PNG (sharp), ET
// contenir au moins un pixel non transparent — trois contrôles indépendants, jamais un seul.
export async function validerEtDecoderSignatureImage(dataUrl: string): Promise<ResultatValidationSignature> {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(PREFIXE_DATA_URL_PNG)) return { statut: "absente" };
  const base64 = dataUrl.slice(PREFIXE_DATA_URL_PNG.length);
  if (!base64) return { statut: "absente" };

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { statut: "format_invalide" };
  }
  if (buffer.byteLength === 0) return { statut: "absente" };
  if (buffer.byteLength > TAILLE_MAX_SIGNATURE_OCTETS) return { statut: "trop_grande" };

  const emptiness = await bufferSignatureEstVide(buffer);
  if (emptiness === "format_invalide") return { statut: "format_invalide" };
  if (emptiness === "vide") return { statut: "vide" };

  return { statut: "valide", buffer };
}
