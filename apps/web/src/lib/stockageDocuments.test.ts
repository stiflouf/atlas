import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";

// vi.spyOn ne peut pas intercepter les exports de "node:fs/promises" (propriétés non
// reconfigurables du module natif, "Cannot redefine property") — vérifié empiriquement. Mock
// partiel avec délégation vers l'implémentation réelle par défaut (même pattern que
// compromis.concurrenceDb.test.ts) : access/mkdir/writeFile deviennent des vi.fn() enveloppant le
// vrai comportement, overridables ponctuellement (mockRejectedValueOnce) dans les deux tests qui en
// ont besoin ; toutes les autres opérations restent réelles pour le reste de la suite.
vi.mock("node:fs/promises", async (importOriginal) => {
  const reel = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...reel,
    access: vi.fn(reel.access),
    mkdir: vi.fn(reel.mkdir),
    writeFile: vi.fn(reel.writeFile),
  };
});

import * as fsPromises from "node:fs/promises";
import {
  ErreurStockageDocumentsIndisponible,
  ecrireDocument,
  genererCleStockage,
  lireDocument,
  resoudreRepertoireStockageDocuments,
  verifierDisponibiliteStockageDocuments,
} from "./stockageDocuments";

// ADR-050 : isolation stricte — chaque test utilise un répertoire temporaire unique via
// ATLAS_DOCUMENT_STORAGE_DIR, jamais le dossier de dev réel `stockage-documents/` (une commande
// lancée depuis un autre cwd a déjà démontré, dans une session précédente, qu'un stockage parasite
// peut apparaître silencieusement — cette suite ne doit jamais dépendre de process.cwd()).
const tmpDirsCrees: string[] = [];

async function creerTmpDir(): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(tmpdir(), "atlas-stockage-test-"));
  tmpDirsCrees.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of tmpDirsCrees.splice(0)) {
    await fsPromises.rm(dir, { recursive: true, force: true });
  }
});

describe("resoudreRepertoireStockageDocuments() — ADR-050", () => {
  it("hors production, variable absente : repli sur process.cwd()/stockage-documents", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");
    expect(resoudreRepertoireStockageDocuments()).toBe(path.join(process.cwd(), "stockage-documents"));
  });

  it("variable définie absolue (hors production) : ce chemin est utilisé tel quel", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);
    expect(resoudreRepertoireStockageDocuments()).toBe(dir);
  });

  it("production, variable absente : refuse explicitement (fail-closed)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");
    expect(() => resoudreRepertoireStockageDocuments()).toThrow(ErreurStockageDocumentsIndisponible);
  });

  it("production, chemin relatif : refuse explicitement", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "chemin/relatif");
    expect(() => resoudreRepertoireStockageDocuments()).toThrow(ErreurStockageDocumentsIndisponible);
  });
});

describe("verifierDisponibiliteStockageDocuments() — ADR-050", () => {
  it("production, répertoire absolu existant et accessible : résout sans erreur (lecture et écriture)", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    await expect(verifierDisponibiliteStockageDocuments()).resolves.toBe(dir);
    await expect(verifierDisponibiliteStockageDocuments({ ecriture: true })).resolves.toBe(dir);
  });

  it("production, répertoire absolu inexistant : refuse explicitement, aucune création automatique", async () => {
    const dirParent = await creerTmpDir();
    const dirInexistant = path.join(dirParent, "nexistepas");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirInexistant);

    await expect(verifierDisponibiliteStockageDocuments()).rejects.toThrow(ErreurStockageDocumentsIndisponible);

    // Preuve réelle (pas un mock) : le répertoire parent reste vide — aucun mkdir n'a eu lieu.
    const contenuParent = await fsPromises.readdir(dirParent);
    expect(contenuParent).toEqual([]);
  });

  it("production, chemin configuré pointant vers un fichier (pas un répertoire) : refuse explicitement", async () => {
    const dirParent = await creerTmpDir();
    const cheminFichier = path.join(dirParent, "fichier.txt");
    await fsPromises.writeFile(cheminFichier, "contenu");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", cheminFichier);

    await expect(verifierDisponibiliteStockageDocuments()).rejects.toThrow(ErreurStockageDocumentsIndisponible);
  });

  it("production, répertoire non inscriptible : refuse en écriture (mock ciblé — chmod non fiable, process root dans cet environnement)", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    vi.mocked(fsPromises.access).mockRejectedValueOnce(new Error("EACCES (simulé)"));

    await expect(verifierDisponibiliteStockageDocuments({ ecriture: true })).rejects.toThrow(
      ErreurStockageDocumentsIndisponible
    );
  });

  it("hors production, répertoire absent : créé automatiquement (comportement dev préservé)", async () => {
    const dirParent = await creerTmpDir();
    const dirACreer = path.join(dirParent, "nouveau-sous-dossier");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirACreer);

    const resolu = await verifierDisponibiliteStockageDocuments({ ecriture: true });
    expect(resolu).toBe(dirACreer);
    const infos = await fsPromises.stat(dirACreer);
    expect(infos.isDirectory()).toBe(true);
  });
});

describe("ecrireDocument() / lireDocument() — round-trip sur répertoire configuré", () => {
  it("écrit puis relit exactement les mêmes octets, physiquement dans le répertoire configuré", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    const cle = genererCleStockage();
    const contenu = Buffer.from("contenu de test ADR-050");
    await ecrireDocument(cle, contenu);

    await expect(fsPromises.stat(path.join(dir, cle))).resolves.toBeDefined();
    // Jamais écrit dans le repli process.cwd()/stockage-documents tant que la variable est définie.
    await expect(fsPromises.stat(path.join(process.cwd(), "stockage-documents", cle))).rejects.toThrow();

    const relu = await lireDocument(cle);
    expect(relu).toBeDefined();
    expect(Buffer.compare(relu as Buffer, contenu)).toBe(0);
  });

  it("lireDocument() retourne undefined pour un fichier précis absent, répertoire valide (comportement 404 préservé)", async () => {
    const dir = await creerTmpDir();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);

    await expect(lireDocument(genererCleStockage())).resolves.toBeUndefined();
  });

  it("lireDocument() lève ErreurStockageDocumentsIndisponible si la racine est indisponible — jamais undefined (distinction critique ADR-050)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");

    await expect(lireDocument("nimporte-quelle-cle")).rejects.toThrow(ErreurStockageDocumentsIndisponible);
  });
});

describe("fail-closed production — test essentiel ADR-050", () => {
  it("production, variable absente, ecrireDocument() : aucun mkdir/writeFile réel n'est appelé, erreur explicite avant toute I/O", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");

    vi.mocked(fsPromises.mkdir).mockClear();
    vi.mocked(fsPromises.writeFile).mockClear();

    await expect(ecrireDocument(genererCleStockage(), Buffer.from("x"))).rejects.toThrow(
      ErreurStockageDocumentsIndisponible
    );

    expect(fsPromises.mkdir).not.toHaveBeenCalled();
    expect(fsPromises.writeFile).not.toHaveBeenCalled();
  });
});

describe("genererCleStockage()", () => {
  it("produit des clés uniques au format UUID", () => {
    const a = genererCleStockage();
    const b = genererCleStockage();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
