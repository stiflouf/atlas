import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { like } from "drizzle-orm";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// Test d'intégration réel (Postgres local) — les FK documents_bien/photos_bien -> biens imposent un
// bienId réel, et l'inventaire lit véritablement la base.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien } = await import("../bienRepository");
const { enregistrerDocumentBien } = await import("../documentBienRepository");
const { ecrireDocument, genererCleStockage } = await import("../stockageDocuments");
const { ecrirePhotoOptimisee, ecrirePhotoOriginale } = await import("../stockagePhotosBien");
const { ajouterPhotoBien } = await import("../photoBienRepository");
const { inventorierOrphelins } = await import("./inventaireOrphelins");

const REFERENCE_PREFIX = "[test réel] ADR067-INVENTAIRE";
const tmpDirsCrees: string[] = [];

afterAll(async () => {
  // ON DELETE CASCADE (bienId -> biens.id) nettoie documents_bien et photos_bien.
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of tmpDirsCrees.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function racineIsolee(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "atlas-inventaire-orphelins-test-"));
  tmpDirsCrees.push(dir);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dir);
  return dir;
}

async function creerBienTest(suffixe: string) {
  return creerBien(
    {
      reference: `${REFERENCE_PREFIX}-${suffixe}-${Math.random().toString(36).slice(2)}`,
      titre: "Bien de test inventaire",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
}

describe("inventorierOrphelins — référence en base sans fichier sur disque", () => {
  it("signale une ligne documents_bien dont le fichier est absent", async () => {
    await racineIsolee();
    const bien = await creerBienTest("ref-sans-fichier");
    const cle = genererCleStockage();
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Diagnostic absent",
      categorie: "diagnostic",
      nomFichierOriginal: "dpe.pdf",
      cleStockage: cle,
      tailleOctets: 1024,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    const inventaire = await inventorierOrphelins();

    expect(inventaire.entrees).toEqual(
      expect.arrayContaining([
        { genre: "document", motif: "reference_sans_fichier", ligneId: document.id, table: "documents_bien" },
      ])
    );
  });

  it("ne signale rien pour une référence dont le fichier est bien présent", async () => {
    await racineIsolee();
    const bien = await creerBienTest("ref-avec-fichier");
    const cle = genererCleStockage();
    await ecrireDocument(cle, Buffer.from("contenu présent"));
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Diagnostic présent",
      categorie: "diagnostic",
      nomFichierOriginal: "dpe.pdf",
      cleStockage: cle,
      tailleOctets: 1024,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    const inventaire = await inventorierOrphelins();

    expect(inventaire.entrees.filter((e) => e.ligneId === document.id)).toEqual([]);
  });

  it("traite les deux fichiers d'une photo séparément : l'original manquant est signalé, l'optimisée présente non", async () => {
    await racineIsolee();
    const bien = await creerBienTest("photo-partielle");
    const cle = genererCleStockage();
    await ecrirePhotoOptimisee(cle, Buffer.from("optimisee seule"));
    const photo = await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: cle,
      nomFichierOriginal: "photo.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 2048,
      hashSha256: "a".repeat(64),
    }, WORKSPACE_TEST);

    const inventaire = await inventorierOrphelins();
    const pourCettePhoto = inventaire.entrees.filter((e) => e.ligneId === photo.id);

    expect(pourCettePhoto).toEqual([
      { genre: "photo_originale", motif: "reference_sans_fichier", ligneId: photo.id, table: "photos_bien" },
    ]);
  });

  it("classe une clé de stockage non conforme en cle_non_verifiable, jamais en fichier absent", async () => {
    await racineIsolee();
    const bien = await creerBienTest("cle-non-conforme");
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Document à clé héritée",
      categorie: "autre",
      nomFichierOriginal: "ancien.pdf",
      cleStockage: `cle-non-uuid-${Math.random().toString(36).slice(2)}`,
      tailleOctets: 10,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    const inventaire = await inventorierOrphelins();

    expect(inventaire.entrees).toEqual(
      expect.arrayContaining([
        { genre: "document", motif: "cle_non_verifiable", ligneId: document.id, table: "documents_bien" },
      ])
    );
  });
});

describe("inventorierOrphelins — fichier sur disque sans référence en base", () => {
  it("ne balaie pas le disque par défaut et le dit explicitement", async () => {
    const dir = await racineIsolee();
    const cleOrpheline = genererCleStockage();
    await ecrireDocument(cleOrpheline, Buffer.from("fichier sans ligne"));

    const inventaire = await inventorierOrphelins();

    expect(inventaire.balayageDisqueEffectue).toBe(false);
    expect(inventaire.fichiersExamines).toBe(0);
    expect(inventaire.entrees.filter((e) => e.motif === "fichier_sans_reference")).toEqual([]);
    // Le fichier n'a pas été touché pour autant.
    await expect(stat(path.join(dir, cleOrpheline))).resolves.toBeDefined();
  });

  it("signale un fichier orphelin quand le balayage disque est demandé", async () => {
    await racineIsolee();
    const cleOrpheline = genererCleStockage();
    await ecrireDocument(cleOrpheline, Buffer.from("fichier sans ligne"));

    const inventaire = await inventorierOrphelins({ balayerDisque: true });

    expect(inventaire.balayageDisqueEffectue).toBe(true);
    expect(inventaire.entrees).toEqual(
      expect.arrayContaining([
        { genre: "document", motif: "fichier_sans_reference", nomFichier: cleOrpheline },
      ])
    );
  });

  it("ne signale pas comme orphelin un fichier correctement référencé", async () => {
    await racineIsolee();
    const bien = await creerBienTest("fichier-reference");
    const cle = genererCleStockage();
    await ecrireDocument(cle, Buffer.from("contenu"));
    await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Document référencé",
      categorie: "autre",
      nomFichierOriginal: "x.pdf",
      cleStockage: cle,
      tailleOctets: 7,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    const inventaire = await inventorierOrphelins({ balayerDisque: true });

    expect(inventaire.entrees.filter((e) => e.nomFichier === cle)).toEqual([]);
  });

  it("supporte une racine dont les sous-répertoires photos n'existent pas encore", async () => {
    await racineIsolee();
    await expect(inventorierOrphelins({ balayerDisque: true })).resolves.toMatchObject({
      balayageDisqueEffectue: true,
    });
  });
});

describe("inventorierOrphelins — garanties de lecture seule (ADR-067)", () => {
  it("ne supprime aucun fichier, ni référencé ni orphelin", async () => {
    const dir = await racineIsolee();
    const bien = await creerBienTest("lecture-seule");
    const cleReferencee = genererCleStockage();
    const cleOrpheline = genererCleStockage();
    const clePhoto = genererCleStockage();
    await ecrireDocument(cleReferencee, Buffer.from("référencé"));
    await ecrireDocument(cleOrpheline, Buffer.from("orphelin"));
    await ecrirePhotoOriginale(clePhoto, Buffer.from("original"));
    await ecrirePhotoOptimisee(clePhoto, Buffer.from("optimisée"));
    await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Document référencé",
      categorie: "autre",
      nomFichierOriginal: "x.pdf",
      cleStockage: cleReferencee,
      tailleOctets: 9,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    await inventorierOrphelins({ balayerDisque: true });

    await expect(stat(path.join(dir, cleReferencee))).resolves.toBeDefined();
    await expect(stat(path.join(dir, cleOrpheline))).resolves.toBeDefined();
    await expect(stat(path.join(dir, "photos", "originaux", clePhoto))).resolves.toBeDefined();
    await expect(stat(path.join(dir, "photos", "optimisees", `${clePhoto}.webp`))).resolves.toBeDefined();
  });

  it("ne supprime aucune ligne en base", async () => {
    await racineIsolee();
    const bien = await creerBienTest("aucune-suppression-db");
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Document conservé",
      categorie: "autre",
      nomFichierOriginal: "x.pdf",
      cleStockage: genererCleStockage(),
      tailleOctets: 9,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    await inventorierOrphelins({ balayerDisque: true });

    const { listerDocumentsPourBien } = await import("../documentBienRepository");
    const restants = await listerDocumentsPourBien(bien.id);
    expect(restants.map((d) => d.id)).toContain(document.id);
  });

  it("le module ne contient aucune primitive destructive", async () => {
    const { readFile } = await import("node:fs/promises");
    const code = await readFile(path.join(process.cwd(), "src/lib/stockage/inventaireOrphelins.ts"), "utf8");

    expect(code).not.toMatch(/\bunlink\b|\brmdir\b|\brimraf\b|\brm\s*\(/);
    expect(code).not.toMatch(/supprimerFichierStocke|\.delete\(|\.update\(|\.insert\(/);
  });

  it("l'inventaire n'expose aucun nom de fichier d'origine ni donnée métier", async () => {
    await racineIsolee();
    const bien = await creerBienTest("sans-pii");
    await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Mandat Dupont",
      categorie: "mandat",
      nomFichierOriginal: "mandat-dupont-confidentiel.pdf",
      cleStockage: genererCleStockage(),
      tailleOctets: 9,
      typeMime: "application/pdf",
      etatVerification: "non_verifie",
    });

    const inventaire = await inventorierOrphelins();
    const serialise = JSON.stringify(inventaire);

    expect(serialise).not.toContain("mandat-dupont-confidentiel.pdf");
    expect(serialise).not.toContain("Mandat Dupont");
  });
});
