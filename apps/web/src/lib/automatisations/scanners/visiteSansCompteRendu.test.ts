import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_AUTOMATION_V1 (ADR-063) — tests d'intégration réels du scanner visite_sans_compte_rendu :
// création après seuil, idempotence (CR = terminaison définitive de la condition), obsolescence
// (CR créé, annulation). Isolation workspace testée au niveau requête
// (visiteRepository.automation.test.ts), même convention que visiteJ1.test.ts.
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
const { creerVisite, annulerVisite } = await import("@/lib/visiteRepository");
const { creerCompteRenduEtRealiserVisite } = await import("@/lib/compteRenduVisiteRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import("../configurationAutomatisationRepository");
const { scannerVisiteSansCompteRendu } = await import("./visiteSansCompteRendu");

const REGLE = "visite_sans_compte_rendu" as const;

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
    // evenements_metier référence visites (visite_sans_compte_rendu) EN NO ACTION, et référence
    // aussi comptes_rendus_visite (visite_realisee, posé par creerCompteRenduEtRealiserVisite dans
    // le test de réalisation) — les deux chaînes doivent être purgées avant la suppression cascade.
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

async function uneVisiteNative(datePrevue: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] VISITESANSCR-SCAN-${compteur}-${Date.now()}`,
      titre: "Bien scanner visite sans CR",
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
  const acquereur = await creerAcquereur(
    {
      prenom: "Jean",
      nom: `VisiteSansCR-${compteur}`,
      email: `visite-sans-cr-${compteur}@test.local`,
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
  const resultat = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue }, WORKSPACE_TEST);
  if (resultat.statut !== "creee") throw new Error("création de visite attendue");
  idsVisites.push(resultat.visite.id);
  return { bien, acquereur, visite: resultat.visite };
}

async function tachesOuvertesDeLaVisite(visiteId: string) {
  const toutes = await getDb().select().from(tachesTable).where(eq(tachesTable.visiteCanoniqueId, visiteId));
  return toutes.filter((t) => !t.termineeLe && !t.annuleeLe);
}

describe("scannerVisiteSansCompteRendu", () => {
  it("§41 — visite passée, planifiee, aucun CR, au-delà du seuil → tâche créée ; rescan → toujours une", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-08-01");
    const maintenant = new Date("2026-08-03T10:00:00Z"); // 2 jours après, seuil 1 jour franchi

    const premier = await scannerVisiteSansCompteRendu(maintenant);
    expect(premier).toMatchObject({ execute: true, nombreOccurrencesCreees: 1 });
    const ouvertes1 = await tachesOuvertesDeLaVisite(visite.id);
    expect(ouvertes1).toHaveLength(1);
    expect(ouvertes1[0].titre).toBe("Compléter le compte rendu de visite");
    expect(ouvertes1[0].origine).toBe("automatique");
    expect(ouvertes1[0].origineCode).toBe(REGLE);

    const second = await scannerVisiteSansCompteRendu(maintenant);
    expect(second).toMatchObject({ execute: true, nombreOccurrencesCreees: 0 });
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("ne crée aucune tâche avant le seuil (visite hier seulement, seuil 1 jour)", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-08-10");
    const maintenant = new Date("2026-08-10T10:00:00Z"); // le jour même, pas encore de seuil franchi

    await scannerVisiteSansCompteRendu(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§42 — CR créé (Visite → realisee) → tâche clôturée, condition définitivement terminée", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite, bien, acquereur } = await uneVisiteNative("2026-08-20");
    const maintenant = new Date("2026-08-22T10:00:00Z");
    await scannerVisiteSansCompteRendu(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: visite.id, dateVisite: "2026-08-20", retour: "R.", interet: "interesse" },
      WORKSPACE_TEST
    );
    await scannerVisiteSansCompteRendu(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });

  it("§43 — visite annulée avant CR → tâche clôturée", async () => {
    await definirSeuilAutomatisation(REGLE, 1, WORKSPACE_TEST);
    await definirActivationAutomatisation(REGLE, true, WORKSPACE_TEST);

    const { visite } = await uneVisiteNative("2026-08-25");
    const maintenant = new Date("2026-08-27T10:00:00Z");
    await scannerVisiteSansCompteRendu(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(1);

    await annulerVisite(visite.id, WORKSPACE_TEST);
    await scannerVisiteSansCompteRendu(maintenant);
    expect(await tachesOuvertesDeLaVisite(visite.id)).toHaveLength(0);

    await definirActivationAutomatisation(REGLE, false, WORKSPACE_TEST);
  });
});
