import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// ADR-047, §14/§25 de l'audit : annulerVisiteAction/reporterVisiteAction n'avaient jusqu'ici AUCUN
// test, direct ou indirect (confirmé par recherche exhaustive) — seule materialiserVisiteAction
// l'était, indirectement, via page.test.tsx. Comportement métier ici, session Atlas mockée valide —
// le refus anonyme est déjà garanti exhaustivement (toutes fonctions, tous fichiers) par
// src/actions/gardeSessionAtlas.structurel.test.ts.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, visites: visitesTable } = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { materialiserVisite, getVisiteById } = await import("@/lib/visiteRepository");
const { annulerVisiteAction, reporterVisiteAction } = await import("./visite");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];

afterAll(async () => {
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerVisitePlanifieeTest(rendezVousCalendarId: string) {
  const bien = await creerBien({
    reference: "[test réel] VISITE-ANNULER-REPORTER",
    titre: "Bien de test",
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

  const acquereur = await creerAcquereur({
    prenom: "Jean",
    nom: "Martin",
    email: `visite-test-${rendezVousCalendarId}@test.local`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);

  const visite = await materialiserVisite({
    bienId: bien.id,
    acquereurId: acquereur.id,
    datePrevue: "2026-03-01",
    rendezVousCalendarId,
  });
  idsVisites.push(visite.id);
  return visite;
}

function formulaireAnnulation(id: string, rendezVousCalendarId: string): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("rendezVousCalendarId", rendezVousCalendarId);
  return formData;
}

function formulaireReport(id: string, rendezVousCalendarId: string, nouvelleDatePrevue: string): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("rendezVousCalendarId", rendezVousCalendarId);
  formData.set("nouvelleDatePrevue", nouvelleDatePrevue);
  return formData;
}

describe("annulerVisiteAction — comportement", () => {
  it("transitionne planifiee -> annulee", async () => {
    const visite = await creerVisitePlanifieeTest("rdv-annulation-test-1");
    await annulerVisiteAction(formulaireAnnulation(visite.id, "rdv-annulation-test-1")).catch(() => {});

    const relue = await getVisiteById(visite.id);
    expect(relue?.statut).toBe("annulee");
  });

  it("une seconde annulation reste sans effet, jamais une erreur bloquante", async () => {
    const visite = await creerVisitePlanifieeTest("rdv-annulation-test-2");
    await annulerVisiteAction(formulaireAnnulation(visite.id, "rdv-annulation-test-2")).catch(() => {});
    await annulerVisiteAction(formulaireAnnulation(visite.id, "rdv-annulation-test-2")).catch(() => {});

    const relue = await getVisiteById(visite.id);
    expect(relue?.statut).toBe("annulee");
  });
});

describe("reporterVisiteAction — comportement", () => {
  it("modifie datePrevue sur la même visite (même id, jamais recréée)", async () => {
    const visite = await creerVisitePlanifieeTest("rdv-report-test-1");
    await reporterVisiteAction(formulaireReport(visite.id, "rdv-report-test-1", "2026-04-15")).catch(() => {});

    const relue = await getVisiteById(visite.id);
    expect(relue?.id).toBe(visite.id);
    expect(relue?.datePrevue).toBe("2026-04-15");
  });

  it("une visite déjà annulée n'est jamais reportée", async () => {
    const visite = await creerVisitePlanifieeTest("rdv-report-test-2");
    await annulerVisiteAction(formulaireAnnulation(visite.id, "rdv-report-test-2")).catch(() => {});
    await reporterVisiteAction(formulaireReport(visite.id, "rdv-report-test-2", "2026-04-15")).catch(() => {});

    const relue = await getVisiteById(visite.id);
    expect(relue?.statut).toBe("annulee");
    expect(relue?.datePrevue).not.toBe("2026-04-15");
  });
});
