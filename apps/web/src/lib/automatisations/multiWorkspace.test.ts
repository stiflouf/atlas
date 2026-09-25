import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B5 (ADR-054) — tests d'intégration réels du moteur d'automatisation avec DEUX
// workspaces réellement présents en base. C'est le seul fichier du moteur à en créer un second :
// avant ce lot, `resoudreWorkspaceExecutionMachine()` levait une exception dès qu'un deuxième
// workspace existait, et tous les tests de scanner documentaient cette limite plutôt que de la
// franchir (voir l'en-tête de scanners/mandatExpireBientot.test.ts avant V2B5).
//
// Couvre T3/T4 (un événement produit une exécution dans SON workspace), T5 (le runner global
// traite A puis B, chacun avec SA configuration), T6 (la reprise d'une exécution de B reste dans
// B), T10 (la tâche générée porte le workspace de son événement) et T11 (le scan de A ne clôture
// jamais une tâche automatique de B — la fuite la plus sévère qu'a trouvée l'audit).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerOffre, accepterOffre } = await import("@/lib/offreRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import(
  "./configurationAutomatisationRepository"
);
const { scannerOffreSansDecision } = await import("./scanners/offreSansDecision");
const { executerScanTemporelComplet } = await import("./scanTemporel");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { reprendreExecutionsBloquees } = await import("./reprise");
const { getExecutionAutomatisationById } = await import("./executionAutomatisationRepository");
const { deriverEtatExecutionAutomatisation } = await import("@/types/automatisation");

const REGLE = "offre_sans_decision" as const;
const M = `ZmultiWs${Date.now()}`;
const WORKSPACE_B = `ws-multi-auto-${Date.now()}`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsOffres: string[] = [];
let compteur = 0;

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] moteur automatisation B" });
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb()
    .update(configurationsAutomatisationTable)
    .set({ active: false, seuilJours: null })
    .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  if (idsOffres.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.offreId, idsOffres));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length > 0) {
      await getDb()
        .delete(executionsAutomatisationTable)
        .where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
    await getDb().delete(tachesTable).where(inArray(tachesTable.offreId, idsOffres));
    await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
  }
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb()
    .delete(configurationsAutomatisationTable)
    .where(eq(configurationsAutomatisationTable.workspaceId, WORKSPACE_B));
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function uneOffreEnCours(workspaceId: string, dateOffre: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] MULTIWS-${compteur}-${Date.now()}`,
      titre: "Bien multi-workspace",
      type: "appartement",
      adresse: "1 rue du Périmètre",
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
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  const resultat = await creerOffre(
    { bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre },
    [],
    workspaceId
  );
  if (resultat.statut !== "creee") throw new Error(`création attendue, reçu ${resultat.statut}`);
  idsOffres.push(resultat.offre.id);
  return resultat.offre;
}

async function tachesOuvertesDeLOffre(offreId: string) {
  const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.offreId, offreId));
  return toutes.filter((t) => !t.termineeLe && !t.annuleeLe);
}

async function evenementEtExecutionDeLOffre(offreId: string) {
  const [evenement] = await getDb()
    .select()
    .from(evenementsMetierTable)
    .where(and(eq(evenementsMetierTable.offreId, offreId), eq(evenementsMetierTable.typeEvenement, REGLE)));
  if (!evenement) return { evenement: undefined, execution: undefined };
  const [execution] = await getDb()
    .select()
    .from(executionsAutomatisationTable)
    .where(eq(executionsAutomatisationTable.evenementId, evenement.id));
  return { evenement, execution };
}

describe("T5 — le runner global traite tous les workspaces, chacun avec sa configuration", () => {
  it("un seul passage du scan temporel produit les effets de A ET de B, sans jamais échouer sur la pluralité", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_B);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    const offreA = await uneOffreEnCours(WORKSPACE_TEST, "2026-06-01");
    const offreB = await uneOffreEnCours(WORKSPACE_B, "2026-06-01");

    const resultats = await executerScanTemporelComplet(new Date("2026-06-10T10:00:00Z"));

    // Le registre a bien été parcouru POUR CHAQUE workspace : une entrée par (workspace, règle).
    const pourLaRegle = resultats.filter((r) => r.codeRegle === REGLE);
    const workspacesVus = pourLaRegle.map((r) => r.workspaceId);
    expect(workspacesVus).toContain(WORKSPACE_TEST);
    expect(workspacesVus).toContain(WORKSPACE_B);

    // Aucun résultat n'est un échec technique : c'est exactement ce que
    // `resoudreWorkspaceExecutionMachine()` provoquait avant ce lot (« Plusieurs workspaces existent »).
    for (const resultat of resultats) {
      if (resultat.execute) expect(resultat.erreurTechnique, `${resultat.codeRegle}/${resultat.workspaceId}`).toBeUndefined();
    }

    // T3 / T4 — chaque offre a produit SON événement, dans SON workspace.
    const a = await evenementEtExecutionDeLOffre(offreA.id);
    const b = await evenementEtExecutionDeLOffre(offreB.id);
    expect(a.evenement?.workspaceId).toBe(WORKSPACE_TEST);
    expect(b.evenement?.workspaceId).toBe(WORKSPACE_B);
    expect(a.execution).toBeDefined();
    expect(b.execution).toBeDefined();
    expect(a.execution!.id).not.toBe(b.execution!.id);

    // T10 — la tâche générée porte le workspace de son événement, et cible bien son offre.
    const tachesA = await tachesOuvertesDeLOffre(offreA.id);
    const tachesB = await tachesOuvertesDeLOffre(offreB.id);
    expect(tachesA).toHaveLength(1);
    expect(tachesB).toHaveLength(1);
    expect(tachesA[0].workspaceId).toBe(WORKSPACE_TEST);
    expect(tachesB[0].workspaceId).toBe(WORKSPACE_B);
    expect(tachesA[0].origine).toBe("automatique");
    expect(tachesB[0].origineCode).toBe(REGLE);

    // Chaque workspace a son propre journal de run : jamais un run partagé.
    const runs = await getDb()
      .select()
      .from(runsScanAutomatisationTable)
      .where(eq(runsScanAutomatisationTable.regleCode, REGLE));
    expect(runs.some((r) => r.workspaceId === WORKSPACE_TEST)).toBe(true);
    expect(runs.some((r) => r.workspaceId === WORKSPACE_B)).toBe(true);
  });

  it("une règle active dans B mais inactive dans A n'agit que dans B", async () => {
    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_B);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    const offreA = await uneOffreEnCours(WORKSPACE_TEST, "2026-06-01");
    const offreB = await uneOffreEnCours(WORKSPACE_B, "2026-06-01");

    const resultats = await executerScanTemporelComplet(new Date("2026-06-10T10:00:00Z"));

    const pourA = resultats.find((r) => r.codeRegle === REGLE && r.workspaceId === WORKSPACE_TEST);
    const pourB = resultats.find((r) => r.codeRegle === REGLE && r.workspaceId === WORKSPACE_B);
    // Inactive dans A : aucun run n'est même créé (un run représente un scan réellement effectué).
    expect(pourA?.execute).toBe(false);
    expect(pourB?.execute).toBe(true);

    expect((await evenementEtExecutionDeLOffre(offreA.id)).evenement).toBeUndefined();
    expect((await evenementEtExecutionDeLOffre(offreB.id)).evenement?.workspaceId).toBe(WORKSPACE_B);
    expect(await tachesOuvertesDeLOffre(offreA.id)).toHaveLength(0);
    expect(await tachesOuvertesDeLOffre(offreB.id)).toHaveLength(1);
  });
});

describe("T11 — le scan d'un workspace ne clôture jamais une tâche automatique d'un autre", () => {
  it("l'offre de A sort du jeu de candidats : la tâche de A est annulée, celle de B reste strictement inchangée", async () => {
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_B);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);

    const offreA = await uneOffreEnCours(WORKSPACE_TEST, "2026-06-01");
    const offreB = await uneOffreEnCours(WORKSPACE_B, "2026-06-01");
    const maintenant = new Date("2026-06-10T10:00:00Z");

    await scannerOffreSansDecision(WORKSPACE_TEST, maintenant);
    await scannerOffreSansDecision(WORKSPACE_B, maintenant);

    const [tacheA] = await tachesOuvertesDeLOffre(offreA.id);
    const [tacheB] = await tachesOuvertesDeLOffre(offreB.id);
    expect(tacheA).toBeDefined();
    expect(tacheB).toBeDefined();

    // État de B AVANT le scan de A — c'est la référence que rien ne doit modifier.
    const [avantB] = await getDb().select().from(tachesTable).where(eq(tachesTable.id, tacheB.id));
    expect(avantB.annuleeLe).toBeNull();

    // L'offre de A est décidée : elle sort du jeu de candidats de A. B, lui, n'a pas bougé et son
    // offre n'a JAMAIS fait partie des candidats de A.
    const decision = await accepterOffre(offreA.id, "2026-06-09", WORKSPACE_TEST);
    expect(decision.statut).toBe("decidee");

    await scannerOffreSansDecision(WORKSPACE_TEST, maintenant);

    // La tâche de A est bien clôturée par obsolescence : la mécanique fonctionne toujours.
    const [apresA] = await getDb().select().from(tachesTable).where(eq(tachesTable.id, tacheA.id));
    expect(apresA.annuleeLe).not.toBeNull();

    // …et celle de B est strictement inchangée. Avant ce lot, la requête d'obsolescence n'avait
    // aucun filtre de workspace : « toute tâche de cette règle absente des candidats de A »
    // incluait la tâche de B, que le scan de A annulait donc en passant.
    const [apresB] = await getDb().select().from(tachesTable).where(eq(tachesTable.id, tacheB.id));
    expect(apresB.annuleeLe).toBeNull();
    expect(apresB.termineeLe).toBeNull();
    expect(apresB.workspaceId).toBe(WORKSPACE_B);
  });
});

describe("T6 — la reprise machine, globale, reste dans le workspace de l'exécution reprise", () => {
  it("une exécution de B laissée 'à traiter' est reprise et produit une tâche de B, sans rien toucher dans A", async () => {
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_B);
    await definirSeuilAutomatisation(REGLE, 2, WORKSPACE_B);
    // A est explicitement désactivé : si la reprise consultait la configuration (elle ne le fait
    // pas, ADR-032 — l'activation est figée à l'émission), ce test le révélerait.
    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);

    const offreB = await uneOffreEnCours(WORKSPACE_B, "2026-06-01");

    // Émission SANS traitement : exactement l'état laissé par un process arrêté entre le commit
    // métier et le traitement synchrone qui suit.
    const emission = await emettreEvenementEtPreparerExecutions(
      { typeEvenement: REGLE, offreId: offreB.id },
      WORKSPACE_B
    );
    expect(emission.evenement?.workspaceId).toBe(WORKSPACE_B);
    expect(emission.idsExecutionsATraiter).toHaveLength(1);
    const executionId = emission.idsExecutionsATraiter[0];
    expect(deriverEtatExecutionAutomatisation((await getExecutionAutomatisationById(executionId))!)).toBe("a_traiter");

    const resultat = await reprendreExecutionsBloquees();
    expect(resultat.examinees).toBeGreaterThanOrEqual(1);

    const execution = await getExecutionAutomatisationById(executionId);
    expect(deriverEtatExecutionAutomatisation(execution!)).toBe("reussie");
    expect(execution!.tacheId).toBeDefined();

    const [tache] = await getDb().select().from(tachesTable).where(eq(tachesTable.id, execution!.tacheId!));
    expect(tache.workspaceId).toBe(WORKSPACE_B);
    expect(tache.offreId).toBe(offreB.id);
    expect(tache.origine).toBe("automatique");
  });
});
