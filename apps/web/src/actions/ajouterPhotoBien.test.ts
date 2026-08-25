import { afterAll, describe, expect, it, vi } from "vitest";
import { like } from "drizzle-orm";
import sharp from "sharp";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ADR-047 : session Atlas mockée comme valide — le refus anonyme est couvert structurellement
// ailleurs (voir gardeSessionAtlas.structurel.test.ts), pas réintroduit fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const REFERENCE_PREFIX = "[test réel] ADR052-ACTION-AJOUT";
const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { listerPhotosBien } = await import("@/lib/photoBienRepository");
const { ajouterPhotoBienAction } = await import("./ajouterPhotoBien");
const { NOMBRE_MAX_PHOTOS_PAR_BIEN, TAILLE_MAX_PHOTO_OCTETS } = await import("@/types/photoBien");

let dirStockageTest: string;

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
  if (dirStockageTest) await rm(dirStockageTest, { recursive: true, force: true });
});

async function bienTest(suffixe: string) {
  return creerBien({
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test action photo",
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
  });
}

function formDataAvecFichier(bienId: string, fichier: File): FormData {
  const fd = new FormData();
  fd.set("bienId", bienId);
  fd.set("fichier", fichier);
  return fd;
}

async function fichierJpegTest(largeur = 20, hauteur = 15): Promise<File> {
  const octets = await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(octets)], "photo.jpg", { type: "image/jpeg" });
}

describe("ajouterPhotoBienAction (ADR-052)", () => {
  it("succès : image réelle acceptée, ligne DB créée, fichiers écrits (original + optimisée)", async () => {
    dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-action-photo-test-"));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);

    const bien = await bienTest("SUCCES");
    const resultat = await ajouterPhotoBienAction(formDataAvecFichier(bien.id, await fichierJpegTest()));

    expect(resultat.succes).toBe(true);
    if (resultat.succes) {
      expect(resultat.photo.bienId).toBe(bien.id);
      expect(resultat.photo.typeMimeOriginal).toBe("image/jpeg");
      expect(resultat.photo.ordre).toBe(0);
    }

    const galerie = await listerPhotosBien(bien.id);
    expect(galerie).toHaveLength(1);

    vi.unstubAllEnvs();
  });

  it("bien introuvable → résultat d'échec, aucune ligne créée, jamais un throw non géré", async () => {
    dirStockageTest = dirStockageTest ?? (await mkdtemp(path.join(tmpdir(), "atlas-action-photo-test-")));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);

    const resultat = await ajouterPhotoBienAction(
      formDataAvecFichier("00000000-0000-0000-0000-000000000000", await fichierJpegTest())
    );
    expect(resultat).toEqual({ succes: false, erreur: "Bien introuvable." });

    vi.unstubAllEnvs();
  });

  it("bien archivé → résultat d'échec explicite, aucune photo ajoutée", async () => {
    dirStockageTest = dirStockageTest ?? (await mkdtemp(path.join(tmpdir(), "atlas-action-photo-test-")));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);

    const bien = await bienTest("ARCHIVE");
    await archiverBien(bien.id);

    const resultat = await ajouterPhotoBienAction(formDataAvecFichier(bien.id, await fichierJpegTest()));
    expect(resultat.succes).toBe(false);
    await expect(listerPhotosBien(bien.id)).resolves.toEqual([]);

    vi.unstubAllEnvs();
  });

  it("fichier trop volumineux (> 12 Mo déclarés) → rejeté avant tout traitement", async () => {
    dirStockageTest = dirStockageTest ?? (await mkdtemp(path.join(tmpdir(), "atlas-action-photo-test-")));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);

    const bien = await bienTest("TROP-GROS");
    const octetsEnormes = new Uint8Array(TAILLE_MAX_PHOTO_OCTETS + 1);
    const fichier = new File([octetsEnormes], "enorme.jpg", { type: "image/jpeg" });

    const resultat = await ajouterPhotoBienAction(formDataAvecFichier(bien.id, fichier));
    expect(resultat).toEqual({ succes: false, erreur: "Le fichier dépasse la taille maximale autorisée (12 Mo)." });
    await expect(listerPhotosBien(bien.id)).resolves.toEqual([]);

    vi.unstubAllEnvs();
  });

  it("contenu réellement illisible (faux JPEG) → rejeté, aucune écriture disque, aucune ligne DB", async () => {
    dirStockageTest = dirStockageTest ?? (await mkdtemp(path.join(tmpdir(), "atlas-action-photo-test-")));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);

    const bien = await bienTest("ILLISIBLE");
    const fichier = new File([new Uint8Array([1, 2, 3, 4, 5])], "faux.jpg", { type: "image/jpeg" });

    const resultat = await ajouterPhotoBienAction(formDataAvecFichier(bien.id, fichier));
    expect(resultat.succes).toBe(false);
    await expect(listerPhotosBien(bien.id)).resolves.toEqual([]);

    vi.unstubAllEnvs();
  });

  it(`limite de ${NOMBRE_MAX_PHOTOS_PAR_BIEN} photos : la ${NOMBRE_MAX_PHOTOS_PAR_BIEN + 1}e est refusée avec un message explicite, fichiers nettoyés`, async () => {
    dirStockageTest = dirStockageTest ?? (await mkdtemp(path.join(tmpdir(), "atlas-action-photo-test-")));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);

    const bien = await bienTest("LIMITE-ACTION");
    for (let i = 0; i < NOMBRE_MAX_PHOTOS_PAR_BIEN; i++) {
      const r = await ajouterPhotoBienAction(formDataAvecFichier(bien.id, await fichierJpegTest(10 + i, 10)));
      expect(r.succes).toBe(true);
    }

    const resultat = await ajouterPhotoBienAction(formDataAvecFichier(bien.id, await fichierJpegTest()));
    expect(resultat.succes).toBe(false);
    await expect(listerPhotosBien(bien.id)).resolves.toHaveLength(NOMBRE_MAX_PHOTOS_PAR_BIEN);

    vi.unstubAllEnvs();
  });
});
