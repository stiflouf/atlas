import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// ADR-050 : ce fichier écrit de vrais fichiers via ecrireDocument (fixture ci-dessous) — répertoire
// temporaire isolé pour toute la suite, jamais le dossier de dev partagé.
let dirStockageTest: string;
beforeAll(async () => {
  dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-documents-route-test-"));
});
afterAll(async () => {
  await rm(dirStockageTest, { recursive: true, force: true });
});

// ADR-047 : /api/documents/[id] exige désormais une session Atlas (appelé par un <a href> HTML
// brut — le cookie de session est envoyé automatiquement par le navigateur, jamais un Bearer).
// Magasin de cookies en mémoire, même patron que sessionAtlas.test.ts — next/headers.cookies()
// n'existe que dans un contexte de requête Next.js réel.
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

const { getDb } = await import("@/db/client");
const { biens: biensTable, documentsBien: documentsBienTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { enregistrerDocumentBien } = await import("@/lib/documentBienRepository");
const { ecrireDocument, genererCleStockage } = await import("@/lib/stockageDocuments");

const idsBiens: string[] = [];
const idsDocuments: string[] = [];

afterAll(async () => {
  for (const id of idsDocuments) await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerDocumentTest(reference: string, contenu: string) {
  const bien = await creerBien({
    reference,
    titre: "Bien de test document",
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
  idsBiens.push(bien.id);

  const cle = genererCleStockage();
  await ecrireDocument(cle, Buffer.from(contenu));
  const document = await enregistrerDocumentBien({
    bienId: bien.id,
    nom: "Document de test",
    categorie: "autre",
    nomFichierOriginal: "document.pdf",
    cleStockage: cle,
    tailleOctets: contenu.length,
    typeMime: "application/pdf",
    etatVerification: "non_verifie",
  });
  idsDocuments.push(document.id);
  return document;
}

describe("GET /api/documents/[id] (ADR-047)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("anonyme + UUID valide → aucun octet transmis (refus explicite (401) AVANT toute lecture du fichier)", async () => {
    const document = await creerDocumentTest("[test réel] DOCUMENT-SECURITE-001", "contenu confidentiel");

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/documents/${document.id}`), {
      params: Promise.resolve({ id: document.id }),
    });

    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toEqual({ erreur: "Non authentifié." });
  });

  it("session Atlas valide → téléchargement normal, contenu exact", async () => {
    const document = await creerDocumentTest("[test réel] DOCUMENT-SECURITE-002", "contenu du document");
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/documents/${document.id}`), {
      params: Promise.resolve({ id: document.id }),
    });

    expect(reponse.status).toBe(200);
    expect(await reponse.text()).toBe("contenu du document");
  });

  it("session Atlas valide + document inexistant → 404 honnête, comportement inchangé", async () => {
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const idInexistant = "00000000-0000-0000-0000-000000000000";
    const reponse = await GET(new Request(`http://localhost/api/documents/${idInexistant}`), {
      params: Promise.resolve({ id: idInexistant }),
    });

    expect(reponse.status).toBe(404);
  });

  // ADR-050 : stockage indisponible/mal configuré ≠ document absent — 503 honnête, jamais un faux
  // 404 qui laisserait croire que le document n'a simplement jamais existé.
  it("session valide + stockage documentaire indisponible → 503, jamais un faux 404", async () => {
    const document = await creerDocumentTest("[test réel] DOCUMENT-STOCKAGE-INDISPONIBLE", "contenu");
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", "");

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`http://localhost/api/documents/${document.id}`), {
      params: Promise.resolve({ id: document.id }),
    });

    expect(reponse.status).toBe(503);
    expect(await reponse.json()).toEqual({ erreur: "Stockage documentaire indisponible." });
  });
});
