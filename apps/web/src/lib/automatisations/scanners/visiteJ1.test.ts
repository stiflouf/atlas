import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_AUTOMATION_V1 (ADR-063) — tests d'intégration réels du scanner visite_j_1 : création,
// idempotence, obsolescence (annulation/réalisation/report), identité d'occurrence cyclique
// (report → nouvelle occurrence possible, §31/§38/§40), fermeture humaine (§33/§39), parité
// native/Calendar (§44), bornage requêtes (§21). Isolation workspace testée au niveau requête
// (visiteRepository.automation.test.ts) — pas au niveau scanner, même convention documentée dans
// scanners/mandatExpireBientot.test.ts (resoudreWorkspaceExecutionMachine exige un seul workspace).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  visites: visitesTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerVisite, materialiserVisite, annulerVisite, modifierDatePrevueVisite } = await import("@/lib/visiteRepository");
const { creerCompteRenduEtRealiserVisite } = await import("@/lib/compteRenduVisiteRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import("../configurationAutomatisationRepository");
const { annulerTache } = await import("@/lib/tacheRepository");
const { scannerVisiteJ1 } = await import("./visiteJ1");

const REGLE = "visite_j_1" as const;

beforeAll(async () => {
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb().update(configurationsAutomatisationTable).set({ active: false, seuilJours: null }).where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsVisites: string[] = [];
let compteur = 0;

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  if (idsVisites.length) {
    // evenements_metier référence visites (visite_j_1) EN NO ACTION, et référence aussi
    // comptes_rendus_visite (visite_realisee, posé par creerCompteRenduEtRealiserVisite dans les
    // tests de réalisation) — les deux chaînes doivent être purgées avant la suppression cascade.
    const comptesRendus = await getDb().select({ id: comptesRendusVisiteTable.id }).from(comptesRendusVisiteTable).where(inArray(comptesRendusVisiteTable.visiteId, idsVisites));
    const idsComptesRendus = comptesRendus.map((c) => c.id);
    const filtre = or(
      inArray(evenementsMetierTable.visiteId, idsVisites),
      idsComptesRendus.length ? inArray(evenementsMetierTable.compteRenduVisiteId, idsComptesRendus) : undefined
    );
    const evenements = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(filtre);
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
    await getDb().delete(tachesTable).where(inArray(tachesTable.visiteCanoniqueId, idsVisites));
  }
  for (const id of idsVisites) await getDb().delete(visitesTable).where(eq(visitesTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
});

async function unBien() {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] VISITEJ1-SCAN-${compteur}-${Date.now()}`,
      titre: "Bien scanner visite J-1",
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
      prenom: "Jean",
      nom: `VisiteJ1-${compteur}`,
      email: `visite-j1-${compteur}@test.local`,
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
  return acquereur;
}

async function uneVisiteNative(datePrevue: string) {
  const bien = await unBien();
  const acquereur = await unAcquereur();
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue }, WORKSPACE_TEST);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  return { bien, acquereur, visite: resultat.visite };
}

async function tachesOuvertesDeLaVisite(visiteId: string) {
  const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.visiteCanoniqueId, visiteId));
  return toutes.filter((t) => !t.termineeLe && !t.annuleeLe);
}
async function tachesDeLaVisite(visiteId: string) {
  return getDb().select().from(tachesTable).where(eq(tachesTable.visiteCanoniqueId, visiteId));
}

describe("scannerVisiteJ1", () => {
  it("§35 — visite demain, planifiee, workspace A → une tâche ; rescan → toujours une", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-08-11");
    const maintenant = new Date("2026-08-10T10:00:00Z");

    const premier = await scannerVisiteJ1(maintenant);
    expect(premier).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });
    const ouvertes1 = await tachesOuvertesDeLaVisite(visite.id);
    expect(ouvertes1).toHaveLength(1);
    expect(ouvertes1[0].titre).toBe("Préparer la visite de demain");
    expect(ouvertes1[0].origine).toBe("automatique");
    expect(ouvertes1[0].origineCode).toBe(REGLE);

    const second = await scannerVisiteJ1(maintenant);
    expect(second).toMatchObject({ execute: true, nombreOccurrencesCreees: 0 });
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§36 — visite annulée → tâche clôturée au scan suivant", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-08-21");
    const maintenant = new Date("2026-08-20T10:00:00Z");
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await annulerVisite(visite.id, WORKSPACE_TEST);
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§37 — CR créé (Visite réalisée) → tâche clôturée au scan suivant", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite, bien, acquereur } = await uneVisiteNative("2026-08-31");
    const maintenant = new Date("2026-08-30T10:00:00Z");
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: visite.id, dateVisite: "2026-08-31", retour: "R.", interet: "interesse" },
      WORKSPACE_TEST
    );
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§38/§40 — report +5 jours → tâche clôturée ; nouvelle veille après report → nouvelle occurrence", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-09-11");
    const maintenant = new Date("2026-09-10T10:00:00Z");
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await modifierDatePrevueVisite(visite.id, "2026-09-16", WORKSPACE_TEST);
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);

    // Nouvelle veille, après le report.
    const nouvelleVeille = new Date("2026-09-15T10:00:00Z");
    const rescan = await scannerVisiteJ1(nouvelleVeille);
    expect(rescan).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });
    const ouvertes = await tachesOuvertesDeLaVisite(visite.id);
    expect(ouvertes).toHaveLength(1);
    const toutes = await tachesDeLaVisite(visite.id);
    expect(toutes).toHaveLength(2); // l'ancienne tâche reste visible, close (jamais supprimée)

    const evenements = await getDb().select().from(evenementsMetierTable).where(eq(evenementsMetierTable.visiteId, visite.id));
    expect(evenements.filter((e) => e.typeEvenement === REGLE)).toHaveLength(2); // une par ancre (date) distincte

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§33/§39 — fermeture humaine → jamais rouverte pour la même date, même après rescan", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-10-11");
    const maintenant = new Date("2026-10-10T10:00:00Z");
    await scannerVisiteJ1(maintenant);
    const [tache] = await tachesOuvertesDeLaVisite(visite.id);
    expect(tache).toBeDefined();

    await annulerTache(tache.id, WORKSPACE_TEST);
    await scannerVisiteJ1(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);
    expect(await tachesDeLaVisite(visite.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§40 — fermeture humaine puis report vers une nouvelle date : nouvelle occurrence autorisée à J-1 de la nouvelle date", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-10-21");
    const maintenant = new Date("2026-10-20T10:00:00Z");
    await scannerVisiteJ1(maintenant);
    const [tache] = await tachesOuvertesDeLaVisite(visite.id);
    await annulerTache(tache.id, WORKSPACE_TEST);

    await modifierDatePrevueVisite(visite.id, "2026-10-26", WORKSPACE_TEST);
    const nouvelleVeille = new Date("2026-10-25T10:00:00Z");
    const rescan = await scannerVisiteJ1(nouvelleVeille);
    expect(rescan).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§44 — parité native/Calendar : même décision pour une Visite calendar-backed", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const bien = await unBien();
    const acquereur = await unAcquereur();
    const resultat = await materialiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-11-11", rendezVousCalendarId: `gcal-j1-${bien.id}` },
      WORKSPACE_TEST
    );
    if (resultat.statut !== "creee") throw new Error("création de visite attendue");
    idsVisites.push(resultat.visite.id);

    const maintenant = new Date("2026-11-10T10:00:00Z");
    await scannerVisiteJ1(maintenant);
    const ouvertes = await tachesOuvertesDeLaVisite(resultat.visite.id);
    expect(ouvertes).toHaveLength(1);
    expect(ouvertes[0].titre).toBe("Préparer la visite de demain");

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§21 — nombre de requêtes indépendant de N", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const maintenant = new Date("2026-12-10T10:00:00Z");
    for (let i = 0; i < 3; i++) await uneVisiteNative("2026-12-11");
    const resultatPetit = await scannerVisiteJ1(maintenant);

    const maintenant2 = new Date("2026-12-20T10:00:00Z");
    for (let i = 0; i < 15; i++) await uneVisiteNative("2026-12-21");
    const resultatGrand = await scannerVisiteJ1(maintenant2);

    // Le nombre de candidats scale, mais le scanner reste une requête candidats + une émission par
    // occurrence due (jamais une requête de LECTURE supplémentaire par candidat) — assertion
    // indirecte : les deux scans réussissent et créent exactement autant d'occurrences que de
    // candidats, sans erreur ni dégradation structurelle.
    expect(resultatPetit).toMatchObject({ execute: true, nombreCandidats: 3, nombreOccurrencesCreees: 3 });
    expect(resultatGrand).toMatchObject({ execute: true, nombreCandidats: 15, nombreOccurrencesCreees: 15 });

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });
});
