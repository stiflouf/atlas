import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Tests d'intégration réels (ADR-033) : couvre le scanner I/O — règle inactive/non configurée
// (aucun run), création d'occurrence, absence de doublon au second scan, nouveau cycle après un
// vrai contact malgré une tâche précédente encore ouverte, concurrence (deux scans -> une seule
// occurrence), isolation d'une erreur par prospect, et reprise après interruption par recalcul.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// Référence vers l'implémentation réelle, capturée à l'import du module mocké — nécessaire pour
// restaurer un comportement conditionnel (basé sur l'argument, jamais sur l'ordre d'appel : le
// scan peut traiter d'autres prospects hérités de tests précédents dans le même fichier, non
// nettoyés avant `afterAll`, voir la convention déjà en place dans les autres suites ADR-032).
let emettreEvenementReel: typeof import("./evenementMetierRepository").emettreEvenementEtPreparerExecutions;
const emettreEvenementMock = vi.fn();
vi.mock("./evenementMetierRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./evenementMetierRepository")>();
  emettreEvenementReel = actual.emettreEvenementEtPreparerExecutions;
  emettreEvenementMock.mockImplementation((...args: Parameters<typeof actual.emettreEvenementEtPreparerExecutions>) =>
    emettreEvenementReel(...args)
  );
  return { ...actual, emettreEvenementEtPreparerExecutions: emettreEvenementMock };
});

const { getDb } = await import("@/db/client");
const {
  prospectsVendeurs: prospectsVendeursTable,
  taches: tachesTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  runsScanAutomatisation: runsScanAutomatisationTable,
  configurationsAutomatisation: configurationsAutomatisationTable,
} = await import("@/db/schema");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { definirActivationAutomatisation, definirSeuilAutomatisation } = await import(
  "./configurationAutomatisationRepository"
);
const { demarrerRunScanAutomatisation, getDernierRunScanPourRegle } = await import("./runScanAutomatisationRepository");
const { scannerInactiviteProspectVendeur } = await import("./scanTemporel");
const { deriverEtatRunScanAutomatisation } = await import("@/types/automatisation");

const REGLE = "inactivite_prospect_vendeur" as const;

// Point de départ connu pour les deux états PARTAGÉS que ce fichier possède (QUALITY-01).
// 'inactivite_prospect_vendeur' est une identité métier CANONIQUE (clé primaire + CHECK sur
// regle_code) : impossible de lui substituer un code unique par fichier de test, l'isolation passe
// donc par une remise à zéro explicite plutôt que par des identifiants uniques. Sans elle, un run
// laissé par une exécution interrompue avant son `afterAll`, ou par un second processus Vitest
// visant la même base, serait lu par getDernierRunScanPourRegle() à la place du run attendu.
beforeAll(async () => {
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  await getDb()
    .update(configurationsAutomatisationTable)
    .set({ active: false, seuilJoursInactivite: null })
    .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

const idsProspectsCrees: string[] = [];
const idsEvenementsCrees: string[] = [];
const idsTachesCrees: string[] = [];
const idsRunsCrees: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false);
  // Nettoyage par requête plutôt que par suivi manuel (idsEvenementsCrees/idsTachesCrees ci-dessus
  // restent indicatifs) : plusieurs scans de ce fichier peuvent légitimement créer des occurrences
  // pour des prospects hérités d'un test précédent (pollution volontaire, même convention que les
  // autres suites ADR-032/033) — un oubli de suivi manuel ne doit jamais faire échouer le nettoyage.
  if (idsProspectsCrees.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.prospectVendeurId, idsProspectsCrees));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
    const taches = await getDb()
      .select({ id: tachesTable.id })
      .from(tachesTable)
      .where(inArray(tachesTable.prospectVendeurId, idsProspectsCrees));
    const idsTaches = taches.map((t) => t.id);
    if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  }
  // Purge complète du journal pour cette règle (idsRunsCrees reste indicatif) : ce fichier est
  // seul à créer des runs pour 'inactivite_prospect_vendeur', un wipe scopé par règle est donc sûr
  // et exhaustif — table purement technique, sans donnée personnelle.
  await getDb().delete(runsScanAutomatisationTable).where(eq(runsScanAutomatisationTable.regleCode, REGLE));
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
});

// Contourne le repository (aucun setter pour creeLe/dernierContactLe) : nécessaire pour placer un
// prospect de test dans le passé sans attendre réellement le seuil.
async function creerProspectAvecAncre(suffixe: string, ancre: Date, viaContact: boolean): Promise<string> {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Scan temporel ${suffixe}`,
    prenom: "Sophie",
    email: undefined,
    telephone: undefined,
    origineLead: undefined,
    origineLeadDetail: undefined,
    adresseBienPotentiel: undefined,
    secteurBienPotentiel: undefined,
    ville: undefined,
    codePostal: undefined,
    typeBien: undefined,
  });
  idsProspectsCrees.push(prospect.id);
  await getDb()
    .update(prospectsVendeursTable)
    .set(viaContact ? { dernierContactLe: ancre } : { creeLe: ancre })
    .where(eq(prospectsVendeursTable.id, prospect.id));
  return prospect.id;
}

async function recupererEvenementsEtTaches(prospectVendeurId: string) {
  const evenements = await getDb()
    .select()
    .from(evenementsMetierTable)
    .where(eq(evenementsMetierTable.prospectVendeurId, prospectVendeurId));
  const taches = await getDb().select().from(tachesTable).where(eq(tachesTable.prospectVendeurId, prospectVendeurId));
  return { evenements, taches };
}

describe("scannerInactiviteProspectVendeur — règle inactive ou non configurée", () => {
  it("règle inactive : aucun run créé, execute=false", async () => {
    await definirActivationAutomatisation(REGLE, false);
    const resultat = await scannerInactiviteProspectVendeur(new Date("2026-08-14T10:00:00Z"));
    expect(resultat).toEqual({ execute: false });
  });

  it("règle active mais sans seuil configuré : aucun run créé, execute=false", async () => {
    await definirSeuilAutomatisation(REGLE, 7);
    // Repasse le seuil à NULL directement (aucun setter "effacer" côté repository — geste
    // volontairement absent en V1, contourné ici pour le test) pour simuler l'état initial seedé.
    await getDb()
      .update(configurationsAutomatisationTable)
      .set({ seuilJoursInactivite: null })
      .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
    await definirActivationAutomatisation(REGLE, true);
    const resultat = await scannerInactiviteProspectVendeur(new Date("2026-08-14T10:00:00Z"));
    expect(resultat).toEqual({ execute: false });
    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("scannerInactiviteProspectVendeur — création d'occurrence et idempotence", () => {
  it("crée un événement + une tâche pour un prospect dont le seuil est franchi, aucun doublon au second scan", async () => {
    await definirSeuilAutomatisation(REGLE, 7);
    await definirActivationAutomatisation(REGLE, true);

    const maintenant = new Date("2026-08-20T10:00:00Z");
    const prospectId = await creerProspectAvecAncre("OCCURRENCE", new Date("2026-08-01T10:00:00Z"), true);

    const premier = await scannerInactiviteProspectVendeur(maintenant);
    expect(premier).toMatchObject({ execute: true, nombreCandidats: expect.any(Number), nombreOccurrencesCreees: 1 });
    if (premier.execute) idsRunsCrees.push(premier.runId);

    const { evenements: evenementsApres1, taches: tachesApres1 } = await recupererEvenementsEtTaches(prospectId);
    expect(evenementsApres1).toHaveLength(1);
    idsEvenementsCrees.push(evenementsApres1[0].id);
    expect(tachesApres1).toHaveLength(1);
    idsTachesCrees.push(tachesApres1[0].id);
    expect(tachesApres1[0].origine).toBe("automatique");
    expect(tachesApres1[0].origineCode).toBe(REGLE);
    expect(tachesApres1[0].titre).toContain("Sophie");

    // Deuxième scan, même prospect, même seuil franchi : aucun doublon.
    const second = await scannerInactiviteProspectVendeur(maintenant);
    expect(second).toMatchObject({ execute: true, nombreOccurrencesCreees: 0 });
    if (second.execute) idsRunsCrees.push(second.runId);

    const { evenements: evenementsApres2, taches: tachesApres2 } = await recupererEvenementsEtTaches(prospectId);
    expect(evenementsApres2).toHaveLength(1);
    expect(tachesApres2).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false);
  });

  it("un vrai nouveau contact ouvre un nouveau cycle, même si la tâche du cycle précédent est encore ouverte", async () => {
    await definirSeuilAutomatisation(REGLE, 7);
    await definirActivationAutomatisation(REGLE, true);

    const prospectId = await creerProspectAvecAncre("NOUVEAU-CYCLE", new Date("2026-01-01T10:00:00Z"), true);

    const premierScan = await scannerInactiviteProspectVendeur(new Date("2026-01-10T10:00:00Z"));
    if (premierScan.execute) idsRunsCrees.push(premierScan.runId);
    const { evenements: evt1, taches: tache1 } = await recupererEvenementsEtTaches(prospectId);
    expect(evt1).toHaveLength(1);
    idsEvenementsCrees.push(evt1[0].id);
    expect(tache1).toHaveLength(1);
    idsTachesCrees.push(tache1[0].id);
    // La tâche du premier cycle reste volontairement OUVERTE (ni terminée ni annulée) — jamais
    // clôturée par ce test, pour vérifier que ça ne bloque pas le cycle suivant.

    // Un vrai nouveau contact survient (nouvelle ancre), puis un nouveau silence.
    await getDb()
      .update(prospectsVendeursTable)
      .set({ dernierContactLe: new Date("2026-02-01T10:00:00Z") })
      .where(eq(prospectsVendeursTable.id, prospectId));

    const secondScan = await scannerInactiviteProspectVendeur(new Date("2026-02-10T10:00:00Z"));
    if (secondScan.execute) idsRunsCrees.push(secondScan.runId);

    const { evenements: evt2, taches: tache2 } = await recupererEvenementsEtTaches(prospectId);
    expect(evt2).toHaveLength(2);
    idsEvenementsCrees.push(...evt2.filter((e) => !idsEvenementsCrees.includes(e.id)).map((e) => e.id));
    expect(tache2).toHaveLength(2);
    idsTachesCrees.push(...tache2.filter((t) => !idsTachesCrees.includes(t.id)).map((t) => t.id));

    await definirActivationAutomatisation(REGLE, false);
  });

  it("concurrence : deux scans simultanés sur le même prospect ne créent qu'une seule occurrence", async () => {
    await definirSeuilAutomatisation(REGLE, 7);
    await definirActivationAutomatisation(REGLE, true);

    const maintenant = new Date("2026-08-20T10:00:00Z");
    const prospectId = await creerProspectAvecAncre("CONCURRENCE", new Date("2026-08-01T10:00:00Z"), true);

    const [resultatA, resultatB] = await Promise.all([
      scannerInactiviteProspectVendeur(maintenant),
      scannerInactiviteProspectVendeur(maintenant),
    ]);
    if (resultatA.execute) idsRunsCrees.push(resultatA.runId);
    if (resultatB.execute) idsRunsCrees.push(resultatB.runId);

    const { evenements, taches } = await recupererEvenementsEtTaches(prospectId);
    expect(evenements).toHaveLength(1);
    idsEvenementsCrees.push(evenements[0].id);
    expect(taches).toHaveLength(1);
    idsTachesCrees.push(taches[0].id);

    await definirActivationAutomatisation(REGLE, false);
  });

  it("une erreur isolée sur un prospect n'empêche pas le traitement des autres, ni la complétion du run", async () => {
    await definirSeuilAutomatisation(REGLE, 7);
    await definirActivationAutomatisation(REGLE, true);

    const maintenant = new Date("2026-08-20T10:00:00Z");
    const idEnEchec = await creerProspectAvecAncre("ECHEC-ISOLE-A", new Date("2026-08-01T10:00:00Z"), true);
    const idEnSucces = await creerProspectAvecAncre("ECHEC-ISOLE-B", new Date("2026-08-01T10:00:00Z"), true);

    // Échec CIBLÉ sur idEnEchec (jamais sur l'ordre d'appel) : le scan traite aussi, dans la même
    // passe, d'éventuels prospects hérités de tests précédents dans ce fichier — un mock "once"
    // pourrait être consommé par l'un d'eux plutôt que par le prospect visé par ce test.
    emettreEvenementMock.mockImplementation(async (input, executeur) => {
      if ("prospectVendeurId" in input && input.typeEvenement === REGLE && input.prospectVendeurId === idEnEchec) {
        throw new Error("échec simulé pour un prospect");
      }
      return emettreEvenementReel(input, executeur);
    });

    const resultat = await scannerInactiviteProspectVendeur(maintenant);
    emettreEvenementMock.mockImplementation((...args: Parameters<typeof emettreEvenementReel>) => emettreEvenementReel(...args));

    expect(resultat.execute).toBe(true);
    if (resultat.execute) {
      idsRunsCrees.push(resultat.runId);
      expect(resultat.nombreOccurrencesCreees).toBeGreaterThanOrEqual(1);
      expect(resultat.erreurTechnique).toBeUndefined();
      const run = await getDernierRunScanPourRegle(REGLE);
      expect(run?.id).toBe(resultat.runId);
      expect(deriverEtatRunScanAutomatisation(run!)).toBe("termine");
    }

    const { evenements: evtEchec } = await recupererEvenementsEtTaches(idEnEchec);
    expect(evtEchec).toHaveLength(0);
    const { evenements: evtSucces, taches: tacheSucces } = await recupererEvenementsEtTaches(idEnSucces);
    expect(evtSucces).toHaveLength(1);
    idsEvenementsCrees.push(evtSucces[0].id);
    expect(tacheSucces).toHaveLength(1);
    idsTachesCrees.push(tacheSucces[0].id);

    await definirActivationAutomatisation(REGLE, false);
  });

  it("reprise après interruption : un run resté 'en_cours' (crash simulé) n'empêche jamais un scan ultérieur de détecter l'occurrence", async () => {
    await definirSeuilAutomatisation(REGLE, 7);
    await definirActivationAutomatisation(REGLE, true);

    // Simule un run laissé sans jamais être complété (process arrêté en plein scan).
    const runInacheveId = await demarrerRunScanAutomatisation(REGLE);
    idsRunsCrees.push(runInacheveId);
    const runInacheve = await getDernierRunScanPourRegle(REGLE);
    expect(runInacheve?.id).toBe(runInacheveId);
    expect(deriverEtatRunScanAutomatisation(runInacheve!)).toBe("en_cours");

    const prospectId = await creerProspectAvecAncre("REPRISE", new Date("2026-08-01T10:00:00Z"), true);
    const resultat = await scannerInactiviteProspectVendeur(new Date("2026-08-20T10:00:00Z"));
    expect(resultat.execute).toBe(true);
    if (resultat.execute) idsRunsCrees.push(resultat.runId);

    const { evenements, taches } = await recupererEvenementsEtTaches(prospectId);
    expect(evenements).toHaveLength(1);
    idsEvenementsCrees.push(evenements[0].id);
    expect(taches).toHaveLength(1);
    idsTachesCrees.push(taches[0].id);

    await definirActivationAutomatisation(REGLE, false);
  });
});
