import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import {
  ecrirePhotoOptimisee,
  ecrirePhotoOriginale,
  genererCleStockage,
  lirePhotoOptimisee,
  supprimerPhotoOptimisee,
  supprimerPhotoOriginale,
} from "./stockagePhotosBien";

// ADR-050/ADR-052 : isolation stricte, jamais le dossier de dev réel `stockage-documents/` ni un
// répertoire partagé entre tests.
const tmpDirsCrees: string[] = [];

async function creerTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "atlas-photos-test-"));
  tmpDirsCrees.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirsCrees.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("stockagePhotosBien — round-trip original / optimisée (ADR-052)", () => {
  it("écrit puis relit exactement les mêmes octets pour la version optimisée, dans photos/optimisees/", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    const cle = genererCleStockage();
    const contenu = Buffer.from("contenu optimisé de test ADR-052");
    await ecrirePhotoOptimisee(cle, contenu);

    await expect(stat(path.join(dir, "photos", "optimisees", `${cle}.webp`))).resolves.toBeDefined();

    const relu = await lirePhotoOptimisee(cle);
    expect(relu).toBeDefined();
    expect(Buffer.compare(relu as Buffer, contenu)).toBe(0);
  });

  it("l'original est écrit dans photos/originaux/, distinct du répertoire des versions optimisées", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    const cle = genererCleStockage();
    const contenu = Buffer.from("original de test");
    await ecrirePhotoOriginale(cle, contenu);

    const original = await readFile(path.join(dir, "photos", "originaux", cle));
    expect(Buffer.compare(original, contenu)).toBe(0);
    await expect(stat(path.join(dir, "photos", "optimisees", `${cle}.webp`))).rejects.toThrow();
  });

  it("lirePhotoOptimisee() retourne undefined pour une clé précise absente, répertoire valide (comportement 404 attendu côté route)", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    await expect(lirePhotoOptimisee(genererCleStockage())).resolves.toBeUndefined();
  });

  it("supprimerPhotoOriginale()/supprimerPhotoOptimisee() sont idempotentes : fichier déjà absent n'est jamais une erreur", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    const cle = genererCleStockage();
    await expect(supprimerPhotoOriginale(cle)).resolves.toBeUndefined();
    await expect(supprimerPhotoOptimisee(cle)).resolves.toBeUndefined();
  });

  it("supprimerPhotoOriginale()/supprimerPhotoOptimisee() suppriment réellement un fichier existant", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    const cle = genererCleStockage();
    await ecrirePhotoOriginale(cle, Buffer.from("x"));
    await ecrirePhotoOptimisee(cle, Buffer.from("y"));

    await supprimerPhotoOriginale(cle);
    await supprimerPhotoOptimisee(cle);

    await expect(stat(path.join(dir, "photos", "originaux", cle))).rejects.toThrow();
    await expect(lirePhotoOptimisee(cle)).resolves.toBeUndefined();
  });

  // Traversée de chemin : la clé physique n'est JAMAIS dérivée d'une entrée utilisateur — elle est
  // systématiquement produite côté serveur par genererCleStockage() (randomUUID, aucun séparateur
  // de chemin possible). Aucune fonction de ce module n'accepte de chemin fourni par l'appelant :
  // c'est cette garantie de construction, pas une validation de contenu, qui rend la traversée de
  // chemin impossible en pratique (même principe que stockageDocuments.ts, ADR-013).
  it("genererCleStockage() ne produit jamais de séparateur de chemin (garantie structurelle anti-traversée)", () => {
    for (let i = 0; i < 20; i++) {
      const cle = genererCleStockage();
      expect(cle).not.toContain("/");
      expect(cle).not.toContain("\\");
      expect(cle).not.toContain("..");
      expect(cle).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });
});
