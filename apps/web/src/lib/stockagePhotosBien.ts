import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { verifierDisponibiliteStockageDocuments } from "./stockageDocuments";

// Réutilise la racine partagée (ATLAS_DOCUMENT_STORAGE_DIR) et sa garde de disponibilité
// fail-closed (ADR-050) — aucune nouvelle variable d'environnement, aucun nouveau volume Railway
// (ADR-052). Deux sous-répertoires sous cette même racine, jamais mélangés au vocabulaire
// documents_bien : un identifiant opaque (photoBienRepository.genererCleStockage, réexporté
// ci-dessous) sert de base au nom physique des DEUX fichiers d'une même photo — l'original tel
// que reçu, la version optimisée en WebP.
const SOUS_REPERTOIRE_ORIGINAUX = "photos/originaux";
const SOUS_REPERTOIRE_OPTIMISEES = "photos/optimisees";

export { genererCleStockage, ErreurStockageDocumentsIndisponible } from "./stockageDocuments";

async function racinePhotos(sousRepertoire: string, options: { ecriture?: boolean } = {}): Promise<string> {
  const racine = await verifierDisponibiliteStockageDocuments(options);
  const repertoire = path.join(racine, sousRepertoire);
  // Hors production uniquement (comportement de verifierDisponibiliteStockageDocuments déjà
  // appliqué à la racine) : le sous-répertoire photos/... n'existe pas forcément au premier
  // upload sur un poste de développement. En production, la racine elle-même doit déjà exister
  // (fail-closed, ADR-050) — créer aveuglément un sous-répertoire manquant masquerait la même
  // erreur qu'un volume non monté.
  if (process.env.NODE_ENV !== "production" && options.ecriture) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(repertoire, { recursive: true });
  }
  return repertoire;
}

function cheminOriginal(repertoire: string, cleStockage: string): string {
  return path.join(repertoire, cleStockage);
}

function cheminOptimisee(repertoire: string, cleStockage: string): string {
  return path.join(repertoire, `${cleStockage}.webp`);
}

export async function ecrirePhotoOriginale(cleStockage: string, contenu: Buffer): Promise<void> {
  const repertoire = await racinePhotos(SOUS_REPERTOIRE_ORIGINAUX, { ecriture: true });
  await writeFile(cheminOriginal(repertoire, cleStockage), contenu);
}

export async function ecrirePhotoOptimisee(cleStockage: string, contenu: Buffer): Promise<void> {
  const repertoire = await racinePhotos(SOUS_REPERTOIRE_OPTIMISEES, { ecriture: true });
  await writeFile(cheminOptimisee(repertoire, cleStockage), contenu);
}

// undefined uniquement si CE fichier précis est absent (ENOENT) — même distinction que
// lireDocument() vis-à-vis d'un volume indisponible (ErreurStockageDocumentsIndisponible propagée
// telle quelle par verifierDisponibiliteStockageDocuments via racinePhotos()).
export async function lirePhotoOptimisee(cleStockage: string): Promise<Buffer | undefined> {
  const repertoire = await racinePhotos(SOUS_REPERTOIRE_OPTIMISEES);
  try {
    return await readFile(cheminOptimisee(repertoire, cleStockage));
  } catch (erreur) {
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw erreur;
  }
}

// Best-effort, appelée uniquement en compensation (upload) ou après succès DB (suppression) —
// jamais censée faire échouer l'opération appelante : ENOENT (fichier déjà absent) n'est jamais
// une erreur ici, c'est l'état déjà atteint. Toute autre erreur filesystem est relayée à
// l'appelant, qui décide (log, jamais une remontée à l'utilisateur — voir ADR-052 §13).
export async function supprimerPhotoOriginale(cleStockage: string): Promise<void> {
  const repertoire = await racinePhotos(SOUS_REPERTOIRE_ORIGINAUX, { ecriture: true });
  await rm(cheminOriginal(repertoire, cleStockage), { force: true });
}

export async function supprimerPhotoOptimisee(cleStockage: string): Promise<void> {
  const repertoire = await racinePhotos(SOUS_REPERTOIRE_OPTIMISEES, { ecriture: true });
  await rm(cheminOptimisee(repertoire, cleStockage), { force: true });
}
