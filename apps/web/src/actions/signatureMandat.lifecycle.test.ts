import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-060 §13 et §16 — SIGNATURE_ATOMICITY_TARGET : le prospect est relu FOR UPDATE dans le
// workspace de SESSION, les faits du mandat sont exigés, tout existe (bien, jalon, mandat,
// événement) ou rien. Cross-workspace = introuvable. Double submit = un seul bien, un seul mandat.
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceCourantMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  mandats: mandatsTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerProspectVendeur, getProspectVendeurById, signerMandatProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { listerMandatsDuBien } = await import("@/lib/mandatRepository");
const { signerMandatProspectVendeurAction } = await import("./prospectVendeur");

const M = `[test réel] SIGNATURE-LIFECYCLE ${Date.now()}`;
let compteur = 0;
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsProspects.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  const biens = await getDb().select({ id: biensTable.id }).from(biensTable).where(eq(biensTable.titre, M));
  const idsBiens = biens.map((b) => b.id);
  if (idsBiens.length > 0) {
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unProspect(workspace = WORKSPACE_TEST) {
  const prospect = await creerProspectVendeur({ nom: `${M} ${++compteur}` }, workspace);
  idsProspects.push(prospect.id);
  return prospect;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-signature-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace signature" });
  idsWorkspaces.push(id);
  return id;
}

function donneesBien(reference: string) {
  return {
    reference,
    titre: M,
    type: "appartement" as const,
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif" as const,
    dateMandat: "2026-09-01",
    caracteristiques: [],
    description: "",
  };
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

function formulaireSignature(prospectId: string, extra: Record<string, string> = {}): FormData {
  return formulaire({
    id: prospectId,
    reference: `${M} ref ${++compteur}`,
    titre: M,
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: "50",
    pieces: "2",
    prix: "300000",
    statutMandat: "actif",
    dateMandat: "2026-09-01",
    ...extra,
  });
}

async function soumettre(fd: FormData): Promise<string> {
  try {
    await signerMandatProspectVendeurAction(fd);
    return "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

const biensDuProspect = async (prospectId: string) => {
  const p = await getProspectVendeurById(prospectId);
  return p?.bienId ? await listerMandatsDuBien(p.bienId, WORKSPACE_TEST) : [];
};

describe("signerMandatProspectVendeur — repository", () => {
  it("type simple et exclusif ; champs optionnels normalisés ; mandat rattaché au bien", async () => {
    for (const type of ["simple", "exclusif"] as const) {
      const prospect = await unProspect();
      const resultat = await signerMandatProspectVendeur(prospect.id, donneesBien(`${M} ${type}`), WORKSPACE_TEST, {
        type,
        numero: " N-7 ",
        dateFin: "2027-08-31",
        exclusiviteJusquAu: type === "exclusif" ? "2026-12-31" : undefined,
      });
      expect(resultat.statut).toBe("signe");
      if (resultat.statut !== "signe") return;
      expect(resultat.mandat).toMatchObject({ bienId: resultat.bien.id, type, numero: "N-7", dateDebut: "2026-09-01", dateFin: "2027-08-31" });
      expect(resultat.prospect.bienId).toBe(resultat.bien.id);
    }
  });

  it("id invalide / inconnu → introuvable ; cross-workspace → introuvable, rien écrit", async () => {
    expect(await signerMandatProspectVendeur("pas-un-uuid", donneesBien("x"), WORKSPACE_TEST, { type: "simple" })).toEqual({ statut: "introuvable" });
    expect(await signerMandatProspectVendeur("00000000-0000-4000-8000-000000000000", donneesBien("x"), WORKSPACE_TEST, { type: "simple" })).toEqual({ statut: "introuvable" });

    const ailleurs = await unAutreWorkspace("repo");
    const prospect = await unProspect(ailleurs);
    const ref = `${M} cross`;
    expect(await signerMandatProspectVendeur(prospect.id, donneesBien(ref), WORKSPACE_TEST, { type: "simple" })).toEqual({ statut: "introuvable" });
    expect(await getDb().select().from(biensTable).where(eq(biensTable.reference, ref))).toEqual([]);
    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.mandatSigneLe).toBeUndefined();
    expect(relu!.bienId).toBeUndefined();
  });

  it("déjà signé → deja_signe, aucun second bien ni mandat", async () => {
    const prospect = await unProspect();
    const premier = await signerMandatProspectVendeur(prospect.id, donneesBien(`${M} d1`), WORKSPACE_TEST, { type: "simple" });
    expect(premier.statut).toBe("signe");
    expect(await signerMandatProspectVendeur(prospect.id, donneesBien(`${M} d2`), WORKSPACE_TEST, { type: "simple" })).toEqual({ statut: "deja_signe" });
    expect(await getDb().select().from(biensTable).where(eq(biensTable.reference, `${M} d2`))).toEqual([]);
    expect(await biensDuProspect(prospect.id)).toHaveLength(1);
  });

  it("double submit CONCURRENT → un bien, un mandat, un événement ; le perdant voit deja_signe", async () => {
    const prospect = await unProspect();
    const [a, b] = await Promise.all([
      signerMandatProspectVendeur(prospect.id, donneesBien(`${M} c1`), WORKSPACE_TEST, { type: "simple" }),
      signerMandatProspectVendeur(prospect.id, donneesBien(`${M} c2`), WORKSPACE_TEST, { type: "simple" }),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["deja_signe", "signe"]);
    const biens = await getDb().select().from(biensTable).where(inArray(biensTable.reference, [`${M} c1`, `${M} c2`]));
    expect(biens).toHaveLength(1);
    expect(await listerMandatsDuBien(biens[0].id, WORKSPACE_TEST)).toHaveLength(1);
    const evenements = await getDb().select().from(evenementsMetierTable).where(eq(evenementsMetierTable.prospectVendeurId, prospect.id));
    expect(evenements.filter((e) => e.typeEvenement === "mandat_signe")).toHaveLength(1);
  });

  it("rollback APRÈS le bien (panne au mandat) : ni bien, ni jalon, ni mandat", async () => {
    const prospect = await unProspect();
    const ref = `${M} rollback`;
    await expect(
      signerMandatProspectVendeur(prospect.id, { ...donneesBien(ref), dateMandat: "2026-09-01" }, WORKSPACE_TEST, { type: "simple", dateFin: "2026-01-01" })
    ).rejects.toThrow(/incohérentes/);
    expect(await getDb().select().from(biensTable).where(eq(biensTable.reference, ref))).toEqual([]);
    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.mandatSigneLe).toBeUndefined();
    expect(relu!.bienId).toBeUndefined();
    // Et le prospect reste signable ensuite.
    const ok = await signerMandatProspectVendeur(prospect.id, donneesBien(`${ref} 2`), WORKSPACE_TEST, { type: "simple" });
    expect(ok.statut).toBe("signe");
  });
});

describe("signerMandatProspectVendeurAction — orchestration", () => {
  it("succès : redirection vers le bien, un mandat canonique typé", async () => {
    const prospect = await unProspect();
    const issue = await soumettre(formulaireSignature(prospect.id, { typeMandat: "exclusif", numeroMandat: "A-1", dateFinMandat: "2027-08-31" }));
    expect(issue).toMatch(/NEXT_REDIRECT.*\/biens\//);
    const mandats = await biensDuProspect(prospect.id);
    expect(mandats).toHaveLength(1);
    expect(mandats[0]).toMatchObject({ type: "exclusif", numero: "A-1", dateFin: "2027-08-31" });
  });

  it("type manquant ou hors vocabulaire → refus AVANT toute écriture", async () => {
    const prospect = await unProspect();
    expect(await soumettre(formulaireSignature(prospect.id))).toMatch(/type de mandat est obligatoire/);
    expect(await soumettre(formulaireSignature(prospect.id, { typeMandat: "co_exclusif" }))).toMatch(/type de mandat est obligatoire/);
    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.bienId).toBeUndefined();
  });

  it("cross-workspace → notFound (indistinguable d'un inconnu) ; workspace session-only, jamais du formulaire", async () => {
    const ailleurs = await unAutreWorkspace("action");
    const prospect = await unProspect(ailleurs);
    const issue = await soumettre(formulaireSignature(prospect.id, { typeMandat: "simple", workspaceId: ailleurs }));
    expect(issue).toMatch(/NOT_FOUND|404/);
    expect((await getProspectVendeurById(prospect.id))!.bienId).toBeUndefined();
    expect(await soumettre(formulaireSignature("00000000-0000-4000-8000-000000000000", { typeMandat: "simple" }))).toMatch(/NOT_FOUND|404/);
  });

  it("déjà signé → refus explicite, aucun second bien", async () => {
    const prospect = await unProspect();
    expect(await soumettre(formulaireSignature(prospect.id, { typeMandat: "simple" }))).toMatch(/NEXT_REDIRECT/);
    expect(await soumettre(formulaireSignature(prospect.id, { typeMandat: "simple" }))).toMatch(/déjà signé/);
    expect(await biensDuProspect(prospect.id)).toHaveLength(1);
  });

  it("double submit concurrent via l'action → un seul bien", async () => {
    const prospect = await unProspect();
    const issues = await Promise.all([
      soumettre(formulaireSignature(prospect.id, { typeMandat: "simple" })),
      soumettre(formulaireSignature(prospect.id, { typeMandat: "simple" })),
    ]);
    expect(issues.filter((i) => /NEXT_REDIRECT/.test(i))).toHaveLength(1);
    expect(issues.filter((i) => /déjà signé/.test(i))).toHaveLength(1);
    expect(await biensDuProspect(prospect.id)).toHaveLength(1);
  });
});
