import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

let dirStockageTest: string;
beforeAll(async () => {
  dirStockageTest = await mkdtemp(path.join(tmpdir(), "atlas-action-bon-visite-test-"));
});
afterAll(async () => {
  await rm(dirStockageTest, { recursive: true, force: true });
});
beforeEach(() => {
  process.env.ATLAS_DOCUMENT_STORAGE_DIR = dirStockageTest;
});
afterEach(() => {
  delete process.env.ATLAS_DOCUMENT_STORAGE_DIR;
});

// Session Atlas mockée valide (même patron que visite.annulerReporter.test.ts) — le refus anonyme
// est déjà garanti exhaustivement par gardeSessionAtlas.structurel.test.ts.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, visites: visitesTable, bonsVisite: bonsVisiteTable, evenementsMetier, executionsAutomatisation } =
  await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerVisite } = await import("@/lib/visiteRepository");
const { creerBonVisite, getBonVisiteById } = await import("@/lib/bonVisiteRepository");
const { signerBonVisiteAction, creerBonVisiteAction, annulerBrouillonBonVisiteAction } = await import("./bonVisite");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];

afterAll(async () => {
  const bons = idsVisites.length
    ? await getDb().select({ id: bonsVisiteTable.id }).from(bonsVisiteTable).where(inArray(bonsVisiteTable.visiteId, idsVisites))
    : [];
  const idsBons = bons.map((b) => b.id);
  if (idsVisites.length || idsBons.length) {
    const filtre = or(
      idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
      idsBons.length ? inArray(evenementsMetier.bonVisiteId, idsBons) : undefined
    );
    const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
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
async function pngTransparentFactice(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
}

async function visiteDeTest(suffixe: string) {
  const bien = await creerBien(
    {
      reference: `[test réel] ACTION-BON-${suffixe}`,
      titre: "Bien action bon",
      type: "appartement",
      adresse: "1 rue Action",
      ville: "Actionville",
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
      nom: `ActionBon${suffixe}`,
      email: `action-bon-${suffixe}@test.local`,
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
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-06-01" }, WORKSPACE_TEST);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  return resultat.visite;
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.append(cle, valeur);
  return fd;
}

describe("creerBonVisiteAction / annulerBrouillonBonVisiteAction", () => {
  it("crée un brouillon pour une Visite valide", async () => {
    const visite = await visiteDeTest("CREATE1");
    await creerBonVisiteAction(formData({ visiteId: visite.id })).catch(() => {});
    const [ligne] = await getDb().select().from(bonsVisiteTable).where(eq(bonsVisiteTable.visiteId, visite.id));
    expect(ligne?.statut).toBe("brouillon");
  });

  it("annule un brouillon existant", async () => {
    const visite = await visiteDeTest("CANCEL1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    await annulerBrouillonBonVisiteAction(formData({ id: r.bonVisite.id, visiteId: visite.id })).catch(() => {});
    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("annule");
  });
});

describe("signerBonVisiteAction — §29/§30/§44 revalidation serveur", () => {
  it("signe avec des entrées valides", async () => {
    const visite = await visiteDeTest("SIGN1");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const dataUrl = "data:image/png;base64," + (await pngSignatureFactice()).toString("base64");

    await signerBonVisiteAction(
      formData({
        bonVisiteId: r.bonVisite.id,
        visiteId: visite.id,
        nomSignataire: "Dupont",
        prenomSignataire: "Marie",
        roleSignataire: "principal",
        consentement: "on",
        signatureImage: dataUrl,
      })
    ).catch(() => {});

    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("signe");
  });

  it("refuse sans consentement — le bon reste brouillon", async () => {
    const visite = await visiteDeTest("SIGN2");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const dataUrl = "data:image/png;base64," + (await pngSignatureFactice()).toString("base64");

    await signerBonVisiteAction(
      formData({
        bonVisiteId: r.bonVisite.id,
        visiteId: visite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        signatureImage: dataUrl,
      })
    ).catch(() => {});

    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("brouillon");
  });

  it("§29 — refuse une signature visuellement vide même avec consentement coché", async () => {
    const visite = await visiteDeTest("SIGN3");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const dataUrl = "data:image/png;base64," + (await pngTransparentFactice()).toString("base64");

    await signerBonVisiteAction(
      formData({
        bonVisiteId: r.bonVisite.id,
        visiteId: visite.id,
        nomSignataire: "Dupont",
        roleSignataire: "principal",
        consentement: "on",
        signatureImage: dataUrl,
      })
    ).catch(() => {});

    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("brouillon");
  });

  it("refuse un nom de signataire manquant", async () => {
    const visite = await visiteDeTest("SIGN4");
    const r = await creerBonVisite(visite.id, WORKSPACE_TEST);
    if (r.statut !== "cree") throw new Error("brouillon attendu");
    const dataUrl = "data:image/png;base64," + (await pngSignatureFactice()).toString("base64");

    await signerBonVisiteAction(
      formData({
        bonVisiteId: r.bonVisite.id,
        visiteId: visite.id,
        roleSignataire: "principal",
        consentement: "on",
        signatureImage: dataUrl,
      })
    ).catch(() => {});

    expect((await getBonVisiteById(r.bonVisite.id, WORKSPACE_TEST))?.statut).toBe("brouillon");
  });
});
