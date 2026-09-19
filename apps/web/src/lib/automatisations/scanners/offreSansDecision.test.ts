import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — tests d'intégration réels du scanner offre_sans_decision :
// création, idempotence, obsolescence sur chaque transition finale, isolation workspace au niveau
// requête (brief §43 A-F).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  offres: offresTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
  acquereurs: acquereursTable,
} = await import("@/db/schema");
const { creerBien } = await import("./../../bienRepository");
const { creerAcquereur } = await import("./../../clientRepository");
const { creerOffre, refuserOffre } = await import("./../../offreRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import("../configurationAutomatisationRepository");
const { scannerOffreSansDecision } = await import("./offreSansDecision");

const REGLE = "offre_sans_decision" as const;
const M = `Zscanoffre${Date.now()}`;

beforeAll(async () => {
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb().update(configurationsAutomatisationTable).set({ active: false, seuilJours: null }).where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

const idsBiens: string[] = [];
const idsOffres: string[] = [];
const idsAcquereurs: string[] = [];
let compteur = 0;

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
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
      reference: `[test réel] OFFRE-SCAN-${compteur}-${Date.now()}`,
      titre: "Bien scanner offre",
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

async function uneOffreEnCours(dateOffre: string) {
  const bien = await unBien();
  const acquereur = await unAcquereur();
  const r = await creerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre }, [], WORKSPACE_TEST);
  if (r.statut !== "creee") throw new Error(`création attendue, reçu ${r.statut}`);
  idsOffres.push(r.offre.id);
  return r.offre;
}

async function tachesOuvertesDeLOffre(offreId: string) {
  const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.offreId, offreId));
  return toutes.filter((t) => !t.termineeLe && !t.annuleeLe);
}

describe("scannerOffreSansDecision", () => {
  it("A-B. offre en_cours depuis > seuil → tâche ; rescan → toujours 1", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const offre = await uneOffreEnCours("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");

    const premier = await scannerOffreSansDecision(maintenant);
    expect(premier).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });
    const ouvertes = await tachesOuvertesDeLOffre(offre.id);
    expect(ouvertes).toHaveLength(1);
    expect(ouvertes[0].titre).toBe("Offre en attente de décision");
    expect(ouvertes[0].origineCode).toBe(REGLE);

    const second = await scannerOffreSansDecision(maintenant);
    expect(second).toMatchObject({ execute: true, nombreOccurrencesCreees: 0 });
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("C. offre acceptée → tâche clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const offre = await uneOffreEnCours("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(1);

    const { accepterOffre } = await import("./../../offreRepository");
    await accepterOffre(offre.id, "2026-06-11", WORKSPACE_TEST);
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("D. offre refusée → clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const offre = await uneOffreEnCours("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(1);

    await refuserOffre(offre.id, "2026-06-11", "autre", WORKSPACE_TEST);
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("E. offre retirée → clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const offre = await uneOffreEnCours("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(1);

    const { retirerOffre } = await import("./../../offreRepository");
    await retirerOffre(offre.id, "2026-06-11", "autre", WORKSPACE_TEST);
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  // F. "autre workspace → invisible" (brief §43) n'est pas testable au niveau du scanner, pour la
  // même raison structurelle que mandatExpireBientot.test.ts : `resoudreWorkspaceExecutionMachine()`
  // exige qu'un seul workspace existe. Déjà prouvé au niveau requête par
  // `offresEnCoursDepasseesSeuil` ("autre workspace → invisible", offreRepository.automation.test.ts).

  // §45/§46 — mécanisme d'idempotence + politique de fermeture manuelle, testé UNE FOIS ici
  // (identique par construction pour offre_acceptee_sans_compromis et mandat_expire_bientot, déjà
  // couvert pour ce dernier) : l'identité d'occurrence (offreId) est portée par l'index unique
  // partiel `evenements_metier_offre_unique`, jamais par une relecture de `taches`.
  it("tâche fermée manuellement pendant que le fait persiste : jamais rouverte par un scan ultérieur", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const offre = await uneOffreEnCours("2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");
    await scannerOffreSansDecision(maintenant);
    const [tache] = await tachesOuvertesDeLOffre(offre.id);
    expect(tache).toBeDefined();

    const { annulerTache } = await import("./../../tacheRepository");
    await annulerTache(tache.id);
    await scannerOffreSansDecision(maintenant);
    expect(await tachesOuvertesDeLOffre(offre.id)).toHaveLength(0);
    const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.offreId, offre.id));
    expect(toutes).toHaveLength(1); // jamais un doublon recréé

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });
});
