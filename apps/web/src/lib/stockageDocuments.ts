import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Racine du stockage local V1 (voir docs/adr, stockage local vs objet). Hors de public/ : jamais
// servi statiquement, uniquement via le Route Handler /api/documents/[id] qui contrôle l'accès.
// process.cwd() = apps/web (pnpm dev / pnpm build s'exécutent depuis ce dossier).
const STORAGE_ROOT = path.join(process.cwd(), "stockage-documents");

// Identifiant opaque généré ici uniquement — jamais dérivé d'un nom ou chemin fourni par
// l'utilisateur. C'est le seul nom utilisé physiquement sur disque (pas d'extension : le type
// MIME reste en métadonnée DB, restitué au téléchargement).
export function genererCleStockage(): string {
  return randomUUID();
}

function cheminAbsolu(cleStockage: string): string {
  return path.join(STORAGE_ROOT, cleStockage);
}

export async function ecrireDocument(cleStockage: string, contenu: Buffer): Promise<void> {
  await mkdir(STORAGE_ROOT, { recursive: true });
  await writeFile(cheminAbsolu(cleStockage), contenu);
}

// undefined si le fichier est absent (métadonnée DB orpheline) — jamais une exception : le Route
// Handler appelant doit pouvoir répondre 404 proprement dans ce cas.
export async function lireDocument(cleStockage: string): Promise<Buffer | undefined> {
  try {
    return await readFile(cheminAbsolu(cleStockage));
  } catch {
    return undefined;
  }
}
