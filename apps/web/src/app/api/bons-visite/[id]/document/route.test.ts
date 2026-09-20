import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

let dirStockageTest: string;
beforeAll(async () => {
  dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-bon-visite-route-test-"));
});
afterAll(async () => {
  await rm(dirStockageTest, { recursive: true, force: true });
});
beforeEach(() => {
  cookieStoreActuel = creerCookieStoreFactice();
  vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
  vi.stubEnv("ATLAS_DOCUMENT_STORAGE_DIR", dirStockageTest);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ADR-047 : même patron que /api/documents/[id]/route.test.ts — magasin de cookies en mémoire,
// next/headers.cookies() n'existe que dans un contexte de requête Next.js réel. Le refus anonyme
// (401) est donc exercé avec ce même mécanisme réel (pas de mock de session), le comportement
// métier avec une vraie session posée via creerSessionAtlas.
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

// Même patron que /api/biens/[id]/pack-notaire/route.test.ts pour la résolution du workspace — le
// comportement métier de la route est testé avec un workspace mocké, jamais un bootstrap
// d'appartenance réel qui dépendrait de l'allowlist.
let workspaceCourantMock = WORKSPACE_TEST;
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn(() => Promise.resolve(workspaceCourantMock)),
}));

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  bonsVisite: bonsVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerVisite } = await import("@/lib/visiteRepository");
const { creerBonVisite, signerBonVisite } = await import("@/lib/bonVisiteRepository");
const { GET } = await import("./route");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];

afterAll(async () => {
  const bons = idsVisites.length
    ? await getDb().select({ id: bonsVisiteTable.id }).from(bonsVisiteTable).where(inArray(bonsVisiteTable.visiteId, idsVisites))
    : [];
  const idsBons = bons.map((b) => b.id);
  if (idsBons.length) {
    const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(inArray(evenementsMetier.bonVisiteId, idsBons));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length) {
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
    }
  }
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function pngSignatureFactice(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } })
    .png()
    .toBuffer();
}

async function bonSigneDeTest(reference: string) {
  const bien = await creerBien(
    {
      reference,
      titre: "Bien route bon de visite",
      type: "appartement",
      adresse: "1 rue Route",
      ville: "Routeville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  const acquereur = await creerAcquereur(
    {
      prenom: "Jean",
      nom: "Route",
      email: "route@test.local",
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(acquereur.id);
  const resultatVisite = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-06-01" }, WORKSPACE_TEST);
  if (resultatVisite.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultatVisite.visite.id);
  const brouillon = await creerBonVisite(resultatVisite.visite.id, WORKSPACE_TEST);
  if (brouillon.statut !== "cree") throw new Error("brouillon attendu");
  const signature = await signerBonVisite(
    {
      bonVisiteId: brouillon.bonVisite.id,
      nomSignataire: "Route",
      roleSignataire: "principal",
      signatureImagePng: await pngSignatureFactice(),
      consentementConfirme: true,
    },
    WORKSPACE_TEST
  );
  if (signature.statut !== "signe") throw new Error("signature attendue");
  return signature.bonVisite;
}

describe("GET /api/bons-visite/[id]/document (§40/§54)", () => {
  it("anonyme → 401 avant toute lecture (même garde ADR-047 que /api/documents/[id])", async () => {
    const reponse = await GET(new Request("http://localhost/api/bons-visite/x/document"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(reponse.status).toBe(401);
  });

  it("session valide + bon signé du même workspace → téléchargement PDF", async () => {
    workspaceCourantMock = WORKSPACE_TEST;
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "route-sub", email: "conseiller@example.com" });

    const bon = await bonSigneDeTest("[test réel] ROUTE-BON-001");
    const reponse = await GET(new Request(`http://localhost/api/bons-visite/${bon.id}/document`), {
      params: Promise.resolve({ id: bon.id }),
    });
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("Content-Type")).toBe("application/pdf");
    const corps = Buffer.from(await reponse.arrayBuffer());
    expect(corps.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("§54 — session valide mais AUTRE workspace → 404, jamais le document d'un autre périmètre", async () => {
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "route-sub-2", email: "conseiller2@example.com" });

    const bon = await bonSigneDeTest("[test réel] ROUTE-BON-002");
    workspaceCourantMock = "un-autre-workspace-inexistant";
    const reponse = await GET(new Request(`http://localhost/api/bons-visite/${bon.id}/document`), {
      params: Promise.resolve({ id: bon.id }),
    });
    expect(reponse.status).toBe(404);
    workspaceCourantMock = WORKSPACE_TEST;
  });

  it("session valide + id inexistant → 404", async () => {
    workspaceCourantMock = WORKSPACE_TEST;
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "route-sub-3", email: "conseiller3@example.com" });

    const idInexistant = "00000000-0000-0000-0000-000000000000";
    const reponse = await GET(new Request(`http://localhost/api/bons-visite/${idInexistant}/document`), {
      params: Promise.resolve({ id: idInexistant }),
    });
    expect(reponse.status).toBe(404);
  });
});
