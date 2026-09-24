import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — tests d'intégration réels du scanner mandat_expire_bientot :
// création, idempotence, obsolescence (résiliation/remplacement/report hors fenêtre), isolation
// workspace (brief §42 A-F).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  mandats: mandatsTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("./../../bienRepository");
const { creerMandat, creerMandatSuccesseur, resilierMandat } = await import("./../../mandatRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import("../configurationAutomatisationRepository");
const { annulerTache } = await import("./../../tacheRepository");
const { scannerMandatExpireBientot } = await import("./mandatExpireBientot");

const REGLE = "mandat_expire_bientot" as const;

beforeAll(async () => {
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb().update(configurationsAutomatisationTable).set({ active: false, seuilJours: null }).where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

const idsBiens: string[] = [];
const idsWorkspaces: string[] = [];
let compteur = 0;

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  if (idsBiens.length > 0) {
    const evenements = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(eq(evenementsMetierTable.typeEvenement, REGLE));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
    await getDb().delete(tachesTable).where(inArray(tachesTable.bienId, idsBiens));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unBien(workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] MANDAT-SCAN-${compteur}-${Date.now()}`,
      titre: "Bien scanner mandat",
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
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function tachesDuBien(bienId: string) {
  return getDb().select().from(tachesTable).where(eq(tachesTable.bienId, bienId));
}

async function tachesOuvertesDuBien(bienId: string) {
  const toutes = await tachesDuBien(bienId);
  return toutes.filter((t) => !t.termineeLe && !t.annuleeLe);
}

describe("scannerMandatExpireBientot", () => {
  it("A-B. mandat à échéance +20j, seuil 30 → tâche créée ; rescan → toujours 1 tâche", async () => {
    await definirSeuilAutomatisation(REGLE, 30, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const bien = await unBien();
    await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const maintenant = new Date("2026-06-15T10:00:00Z");

    const premier = await scannerMandatExpireBientot(maintenant);
    expect(premier).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });

    const ouvertes1 = await tachesOuvertesDuBien(bien.id);
    expect(ouvertes1).toHaveLength(1);
    expect(ouvertes1[0].titre).toBe("Mandat à renouveler bientôt");
    expect(ouvertes1[0].origine).toBe("automatique");
    expect(ouvertes1[0].origineCode).toBe(REGLE);

    const second = await scannerMandatExpireBientot(maintenant);
    expect(second).toMatchObject({ execute: true, nombreOccurrencesCreees: 0 });
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("C. date_fin repoussée hors fenêtre → tâche automatiquement clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 30, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const maintenant = new Date("2026-06-15T10:00:00Z");
    await scannerMandatExpireBientot(maintenant);
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(1);

    await getDb().update(mandatsTable).set({ dateFin: "2026-12-31" }).where(eq(mandatsTable.id, mandat.id));
    await scannerMandatExpireBientot(maintenant);
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(0);
    const toutes = await tachesDuBien(bien.id);
    expect(toutes[0].annuleeLe).not.toBeNull();

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("D. mandat résilié → tâche clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 30, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const bien = await unBien();
    const mandat = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const maintenant = new Date("2026-06-15T10:00:00Z");
    await scannerMandatExpireBientot(maintenant);
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(1);

    // Résiliation effective au 16/06 : un scan à cette même date (ou après) doit la voir prendre
    // effet — `mandatCourantDuBien`/`mandatsCourantsExpirantBientot` comptent un mandat résilié une
    // date FUTURE comme encore courant jusqu'à cette date (même sémantique partout, ADR-060 §10).
    await resilierMandat(mandat.id, { resilieLe: "2026-06-16" }, WORKSPACE_TEST);
    await scannerMandatExpireBientot(new Date("2026-06-16T10:00:00Z"));
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("E. mandat remplacé → tâche de l'ancien clôturée ; le successeur ouvre une occurrence distincte", async () => {
    await definirSeuilAutomatisation(REGLE, 30, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const bien = await unBien();
    const ancien = await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const maintenant = new Date("2026-06-15T10:00:00Z");
    await scannerMandatExpireBientot(maintenant);
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(1);

    const successeur = await creerMandatSuccesseur(ancien.id, { dateDebut: "2026-07-05", dateFin: "2026-07-10", type: "simple" });
    const rescan = await scannerMandatExpireBientot(maintenant);
    // Nouvelle occurrence légitime pour le successeur (identité de mandat différente), jamais un
    // rejeu de celle de l'ancien.
    expect(rescan).toMatchObject({ execute: true, nombreOccurrencesCreees: 1, nombreTachesObsoletes: 1 });

    const ouvertes = await tachesOuvertesDuBien(bien.id);
    expect(ouvertes).toHaveLength(1);
    const toutes = await tachesDuBien(bien.id);
    expect(toutes).toHaveLength(2); // la tâche de l'ancien reste visible, close (jamais supprimée)

    const evenements = await getDb().select().from(evenementsMetierTable).where(eq(evenementsMetierTable.typeEvenement, REGLE));
    const mandatIds = evenements.map((e) => e.mandatId);
    expect(mandatIds).toContain(ancien.id);
    expect(mandatIds).toContain(successeur.id);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  // F. "autre workspace → aucune fuite" (brief §42) n'est PAS testable au niveau du scanner :
  // `resoudreWorkspaceExecutionMachine()` (ADR-054) exige structurellement qu'un SEUL workspace
  // existe pour qu'un traitement machine s'exécute — insérer un second workspace ici casserait
  // l'appel lui-même (et tout scan concurrent dans la même base de test), jamais un scénario de
  // fuite silencieuse. Le workspace-safety du candidat est déjà prouvé au niveau requête par
  // `mandatsCourantsExpirantBientot` ("autre workspace → invisible", mandatRepository.lifecycle.test.ts)
  // — même convention que scanTemporel.test.ts, qui ne teste pas non plus le cross-workspace au
  // niveau scanner pour la même raison structurelle.

  it("tâche fermée manuellement pendant que le fait persiste : jamais rouverte par un scan ultérieur", async () => {
    await definirSeuilAutomatisation(REGLE, 30, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const bien = await unBien();
    await creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", dateFin: "2026-07-05", type: "simple" });
    const maintenant = new Date("2026-06-15T10:00:00Z");
    await scannerMandatExpireBientot(maintenant);
    const [tache] = await tachesOuvertesDuBien(bien.id);
    expect(tache).toBeDefined();

    await annulerTache(tache.id, WORKSPACE_TEST);
    await scannerMandatExpireBientot(maintenant);
    expect(await tachesOuvertesDuBien(bien.id)).toHaveLength(0);
    expect(await tachesDuBien(bien.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });
});
