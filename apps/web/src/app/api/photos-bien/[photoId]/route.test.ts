import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// ADR-050/052 : ce fichier écrit de vrais fichiers via ecrirePhotoOptimisee — répertoire temporaire
// isolé pour toute la suite, jamais le dossier de dev partagé.
let dirStockageTest: string;
beforeAll(async () => {
  dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-photos-route-test-"));
});
afterAll(async () => {
  await rm(dirStockageTest, { recursive: true, force: true });
});

// ADR-047 : même patron que route.test.ts de /api/documents/[id] — magasin de cookies en mémoire,
// next/headers.cookies() n'existe que dans un contexte de requête Next.js réel.
type CookieFactice = { name: string; value: string };
function creerCookieStoreFactice() {
  const cookies = new Map<string, CookieFactice>();
  return {
    get: (name: string) => cookies.get(name),
    set: (nomOuOptions: string | CookieFactice, valeur?: string) => {
      if (typeof nomOuOptions === "string") cookies.set(nomOuOptions, { name: nomOuOptions, value: valeur ?? "" });
      else cookies.set(nomOuOptions.name, nomOuOptions);
    },
    delete: (name: string) => cookies.delete(name),
  };
}
let cookieStoreActuel = creerCookieStoreFactice();
vi.mock("next/headers", () => ({ cookies: async () => cookieStoreActuel }));

const REFERENCE_PREFIX = "[test réel] ADR052-ROUTE-PHOTO";
const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { ajouterPhotoBien } = await import("@/lib/photoBienRepository");
const { ecrirePhotoOptimisee, genererCleStockage } = await import("@/lib/stockagePhotosBien");

afterAll(async () => {
  await getDb().delete(biensTable).where(like(biensTable.reference, `${REFERENCE_PREFIX}%`));
});

async function creerPhotoTest(suffixe: string, contenuWebp: Buffer) {
  const bien = await creerBien({
    reference: `${REFERENCE_PREFIX}-${suffixe}`,
    titre: "Bien de test route photo",
    type: "appartement",
    adresse: "1 rue Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });

  const cle = genererCleStockage();
  await ecrirePhotoOptimisee(cle, contenuWebp);
  const photo = await ajouterPhotoBien({
    bienId: bien.id,
    cleStockage: cle,
    nomFichierOriginal: "photo.jpg",
    typeMimeOriginal: "image/jpeg",
    tailleOctetsOriginal: contenuWebp.length,
    hashSha256: `hash-${suffixe}`,
  });
  return photo;
}

describe("GET /api/photos-bien/[photoId] (ADR-052)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("anonyme + id valide → 401 AVANT toute lecture du fichier", async () => {
    const contenu = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).webp().toBuffer();
    const photo = await creerPhotoTest("ANONYME", contenu);

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/photos-bien/${photo.id}`), {
      params: Promise.resolve({ photoId: photo.id }),
    });

    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toEqual({ erreur: "Non authentifié." });
  });

  it("id invalide (non-UUID) → 404, jamais un crash", async () => {
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request("http://localhost/api/photos-bien/id-invalide"), {
      params: Promise.resolve({ photoId: "id-invalide" }),
    });

    expect(reponse.status).toBe(404);
  });

  it("session valide + photo inexistante → 404", async () => {
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const idInexistant = "00000000-0000-0000-0000-000000000000";
    const reponse = await GET(new Request(`http://localhost/api/photos-bien/${idInexistant}`), {
      params: Promise.resolve({ photoId: idInexistant }),
    });

    expect(reponse.status).toBe(404);
  });

  it("session valide + ligne DB présente mais fichier physique absent → 404 honnête", async () => {
    const bien = await creerBien({
      reference: `${REFERENCE_PREFIX}-FICHIER-ABSENT`,
      titre: "Bien orphelin",
      type: "appartement",
      adresse: "1 rue Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    });
    const photoOrpheline = await ajouterPhotoBien({
      bienId: bien.id,
      cleStockage: genererCleStockage(), // jamais écrite sur disque
      nomFichierOriginal: "fantome.jpg",
      typeMimeOriginal: "image/jpeg",
      tailleOctetsOriginal: 100,
      hashSha256: "hash-fantome",
    });

    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/photos-bien/${photoOrpheline.id}`), {
      params: Promise.resolve({ photoId: photoOrpheline.id }),
    });

    expect(reponse.status).toBe(404);
  });

  it("session valide + photo présente → 200, WebP, jamais Content-Disposition attachment, cle_stockage jamais exposée", async () => {
    const contenu = await sharp({ create: { width: 8, height: 6, channels: 3, background: "blue" } }).webp().toBuffer();
    const photo = await creerPhotoTest("SUCCES", contenu);
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/photos-bien/${photo.id}`), {
      params: Promise.resolve({ photoId: photo.id }),
    });

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("image/webp");
    expect(reponse.headers.get("Content-Disposition")).toBeNull();
    expect(reponse.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(reponse.headers.get("ETag")).toBeTruthy();

    const octets = Buffer.from(await reponse.arrayBuffer());
    expect(Buffer.compare(octets, contenu)).toBe(0);
    // La clé physique ne doit apparaître nulle part dans la réponse.
    for (const [, valeur] of reponse.headers.entries()) {
      expect(valeur).not.toContain(photo.cleStockage);
    }
  });

  it("304 uniquement APRÈS authentification : anonyme + If-None-Match correct reste 401, jamais 304", async () => {
    const contenu = await sharp({ create: { width: 4, height: 4, channels: 3, background: "green" } }).webp().toBuffer();
    const photo = await creerPhotoTest("ETAG-ANONYME", contenu);
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const premiere = await GET(new Request(`http://localhost/api/photos-bien/${photo.id}`), {
      params: Promise.resolve({ photoId: photo.id }),
    });
    const etag = premiere.headers.get("ETag") as string;

    // Session révoquée entre les deux requêtes.
    cookieStoreActuel = creerCookieStoreFactice();
    const seconde = await GET(
      new Request(`http://localhost/api/photos-bien/${photo.id}`, { headers: { "If-None-Match": etag } }),
      { params: Promise.resolve({ photoId: photo.id }) }
    );

    expect(seconde.status).toBe(401);
  });

  it("session valide + If-None-Match correspondant → 304", async () => {
    const contenu = await sharp({ create: { width: 4, height: 4, channels: 3, background: "yellow" } }).webp().toBuffer();
    const photo = await creerPhotoTest("ETAG-304", contenu);
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const premiere = await GET(new Request(`http://localhost/api/photos-bien/${photo.id}`), {
      params: Promise.resolve({ photoId: photo.id }),
    });
    const etag = premiere.headers.get("ETag") as string;

    const seconde = await GET(
      new Request(`http://localhost/api/photos-bien/${photo.id}`, { headers: { "If-None-Match": etag } }),
      { params: Promise.resolve({ photoId: photo.id }) }
    );

    expect(seconde.status).toBe(304);
  });

  it("session valide + stockage indisponible → 503, jamais un faux 404", async () => {
    const contenu = await sharp({ create: { width: 4, height: 4, channels: 3, background: "black" } }).webp().toBuffer();
    const photo = await creerPhotoTest("STOCKAGE-INDISPONIBLE", contenu);
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/photos-bien/${photo.id}`), {
      params: Promise.resolve({ photoId: photo.id }),
    });

    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ erreur: "Stockage documentaire indisponible." });
  });
});
