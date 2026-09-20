import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_AUTOMATION_V1 (ADR-063) — lecteurs set-based des candidats des scanners `visite_j_1` et
// `visite_sans_compte_rendu` : création, isolation workspace (§45 — testée ICI, au niveau requête,
// jamais au niveau scanner, voir la même convention documentée dans
// scanners/mandatExpireBientot.test.ts), et bornage.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerVisite, annulerVisite } = await import("@/lib/visiteRepository");
const { visitesPlanifieesPourDate, visitesPlanifieesPasseesSeuil } = await import("@/lib/visiteRepository");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];

afterAll(async () => {
  // evenements_metier référence visites en NO ACTION (visite_annulee posé par annulerVisite ici) —
  // purgé avant la suppression des visites, même patron établi ailleurs dans ce domaine.
  if (idsVisites.length) {
    const evenements = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.visiteId, idsVisites));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
  }
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function visiteDeTest(suffixe: string, datePrevue: string, workspaceId = WORKSPACE_TEST) {
  const bien = await creerBien(
    {
      reference: `[test réel] VISITE-AUTOMATION-${suffixe}`,
      titre: "Bien automation visite",
      type: "appartement",
      adresse: "1 rue Automation",
      ville: "Automationville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  const acquereur = await creerAcquereur(
    {
      prenom: "Jean",
      nom: `Automation${suffixe}`,
      email: `automation-${suffixe}@test.local`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue }, workspaceId);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  return { bien, acquereur, visite: resultat.visite };
}

describe("visitesPlanifieesPourDate", () => {
  it("trouve une visite planifiee dont la date prévue correspond exactement", async () => {
    const { visite } = await visiteDeTest("J1-MATCH", "2026-07-15");
    const resultats = await visitesPlanifieesPourDate(WORKSPACE_TEST, "2026-07-15");
    expect(resultats.map((v) => v.id)).toContain(visite.id);
  });

  it("exclut une visite d'une autre date", async () => {
    const { visite } = await visiteDeTest("J1-AUTREDATE", "2026-07-16");
    const resultats = await visitesPlanifieesPourDate(WORKSPACE_TEST, "2026-07-15");
    expect(resultats.map((v) => v.id)).not.toContain(visite.id);
  });

  it("exclut une visite annulée", async () => {
    const { visite } = await visiteDeTest("J1-ANNULEE", "2026-07-17");
    await annulerVisite(visite.id, WORKSPACE_TEST);
    const resultats = await visitesPlanifieesPourDate(WORKSPACE_TEST, "2026-07-17");
    expect(resultats.map((v) => v.id)).not.toContain(visite.id);
  });

  it("§45 — une visite d'un autre workspace est invisible", async () => {
    const { visite } = await visiteDeTest("J1-WORKSPACE", "2026-07-18");
    const resultats = await visitesPlanifieesPourDate("un-autre-workspace-inexistant", "2026-07-18");
    expect(resultats.map((v) => v.id)).not.toContain(visite.id);
  });
});

describe("visitesPlanifieesPasseesSeuil", () => {
  it("trouve une visite planifiee dont la date prévue est antérieure ou égale au seuil", async () => {
    const { visite } = await visiteDeTest("SANSCR-PASSEE", "2026-06-01");
    const resultats = await visitesPlanifieesPasseesSeuil(WORKSPACE_TEST, "2026-06-10");
    expect(resultats.map((v) => v.id)).toContain(visite.id);
  });

  it("exclut une visite dont la date prévue est encore dans le futur par rapport au seuil", async () => {
    const { visite } = await visiteDeTest("SANSCR-FUTURE", "2026-07-01");
    const resultats = await visitesPlanifieesPasseesSeuil(WORKSPACE_TEST, "2026-06-10");
    expect(resultats.map((v) => v.id)).not.toContain(visite.id);
  });

  it("exclut une visite annulée", async () => {
    const { visite } = await visiteDeTest("SANSCR-ANNULEE", "2026-06-01");
    await annulerVisite(visite.id, WORKSPACE_TEST);
    const resultats = await visitesPlanifieesPasseesSeuil(WORKSPACE_TEST, "2026-06-10");
    expect(resultats.map((v) => v.id)).not.toContain(visite.id);
  });

  it("§45 — une visite d'un autre workspace est invisible", async () => {
    const { visite } = await visiteDeTest("SANSCR-WORKSPACE", "2026-06-01");
    const resultats = await visitesPlanifieesPasseesSeuil("un-autre-workspace-inexistant", "2026-06-10");
    expect(resultats.map((v) => v.id)).not.toContain(visite.id);
  });
});
