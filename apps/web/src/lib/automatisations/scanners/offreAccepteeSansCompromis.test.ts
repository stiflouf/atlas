import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — tests d'intégration réels du scanner
// offre_acceptee_sans_compromis : création, idempotence, obsolescence (compromis créé / offre
// devenue caduque), isolation workspace au niveau requête (brief §44 A-D).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  offres: offresTable,
  compromis: compromisTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
  acquereurs: acquereursTable,
} = await import("@/db/schema");
const { creerBien } = await import("./../../bienRepository");
const { creerAcquereur } = await import("./../../clientRepository");
const { accepterOffre, creerOffre, rendreOffreCaduque } = await import("./../../offreRepository");
const { creerCompromis } = await import("./../../compromisRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import("../configurationAutomatisationRepository");
const { scannerOffreAccepteeSansCompromis } = await import("./offreAccepteeSansCompromis");

const REGLE = "offre_acceptee_sans_compromis" as const;
const M = `Zscanoffreacc${Date.now()}`;

beforeAll(async () => {
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb().update(configurationsAutomatisationTable).set({ active: false, seuilJours: null }).where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

const idsBiens: string[] = [];
const idsOffres: string[] = [];
const idsCompromis: string[] = [];
const idsAcquereurs: string[] = [];
let compteur = 0;

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  if (idsCompromis.length > 0) {
    const evtCompromis = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.compromisId, idsCompromis));
    const idsEvtCompromis = evtCompromis.map((e) => e.id);
    if (idsEvtCompromis.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvtCompromis));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvtCompromis));
    }
    await getDb().delete(compromisTable).where(inArray(compromisTable.id, idsCompromis));
  }
  if (idsOffres.length > 0) {
    const evenements = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.offreId, idsOffres));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
    await getDb().delete(tachesTable).where(inArray(tachesTable.offreId, idsOffres));
    await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
  }
  if (idsBiens.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
});

async function unBien() {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] OFFRE-ACC-SCAN-${compteur}-${Date.now()}`,
      titre: "Bien scanner offre acceptée",
      type: "appartement",
      adresse: "1 rue du Scanner",
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
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur() {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `${M} Acquéreur ${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 200000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "offre",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function uneOffreAcceptee(dateDecision: string) {
  const bien = await unBien();
  const acquereur = await unAcquereur();
  const r = await creerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-01-01" }, [], WORKSPACE_TEST);
  if (r.statut !== "creee") throw new Error(`création attendue, reçu ${r.statut}`);
  idsOffres.push(r.offre.id);
  const decision = await accepterOffre(r.offre.id, dateDecision, WORKSPACE_TEST);
  if (decision.statut !== "decidee") throw new Error(`acceptation attendue, reçu ${decision.statut}`);
  return { offre: decision.offre, bien, acquereur };
}

async function tachesOuvertesDeLOffre(offreId: string) {
  const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.offreId, offreId));
  return toutes.filter((t) => !t.termineeLe && !t.annuleeLe);
}

describe("scannerOffreAccepteeSansCompromis", () => {
  it("A-D. offre acceptee depuis > seuil, 0 compromis → tâche ; rescan → 1 ; compromis créé → clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 7, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { offre, bien, acquereur } = await uneOffreAcceptee("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");

    const premier = await scannerOffreAccepteeSansCompromis(maintenant);
    expect(premier).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });
    const ouvertes = await tachesOuvertesDeLOffre(offre.id);
    expect(ouvertes).toHaveLength(1);
    expect(ouvertes[0].titre).toBe("Offre acceptée : préparer le compromis");

    const second = await scannerOffreAccepteeSansCompromis(maintenant);
    expect(second).toMatchObject({ execute: true, nombreOccurrencesCreees: 0 });
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(1);

    const resultatCompromis = await creerCompromis(
      { bienId: bien.id, acquereurId: acquereur.id, offreId: offre.id, prixConvenu: 300000, dateSignature: "2026-06-11" },
      WORKSPACE_TEST
    );
    if (resultatCompromis.statut === "cree") idsCompromis.push(resultatCompromis.compromis.id);
    await scannerOffreAccepteeSansCompromis(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("offre devenue caduque sans compromis → tâche clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 7, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { offre } = await uneOffreAcceptee("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");
    await scannerOffreAccepteeSansCompromis(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(1);

    await rendreOffreCaduque(offre.id, "autre", WORKSPACE_TEST);
    await scannerOffreAccepteeSansCompromis(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });
});
