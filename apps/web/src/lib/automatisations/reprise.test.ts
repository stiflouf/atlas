import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

// Test d'intégration réel (ADR-038) : vraie base Postgres, même patron que moteur.test.ts
// (mock ciblé de creerTache pour simuler une vraie erreur technique — jamais un état de données
// impossible à atteindre en production). Couvre le filet de reprise générique : sélection des
// exécutions `a_traiter`, plafond de tentatives, idempotence/concurrence, `undefined` toujours
// terminal, erreur technique toujours terminale, activation figée jamais rejouée rétroactivement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const creerTacheMock = vi.fn();
vi.mock("@/lib/tacheRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tacheRepository")>();
  creerTacheMock.mockImplementation(actual.creerTache);
  return { ...actual, creerTache: creerTacheMock };
});

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  evenementsMetier,
  executionsAutomatisation,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");
const { getExecutionAutomatisationById } = await import("./executionAutomatisationRepository");
const { reprendreExecutionsBloquees, MAX_TENTATIVES_AUTOMATISATION } = await import("./reprise");

const REGLE = "nouveau_match_bien_acquereur" as const;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  await definirActivationAutomatisation(REGLE, false);
  if (idsBiensCrees.length > 0 || idsAcquereursCrees.length > 0) {
    const filtreEvt = or(inArray(evenementsMetier.bienId, idsBiensCrees), inArray(evenementsMetier.acquereurId, idsAcquereursCrees));
    const sousRequeteEvts = getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtreEvt);
    await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, sousRequeteEvts));
    await getDb().delete(evenementsMetier).where(filtreEvt);
  }
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function creerBienDeTest(suffixe: string, prix = 300000) {
  const bien = await creerBien({
    reference: `[test réel] REPRISE-${suffixe}`,
    titre: "Bien de test reprise",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 3,
    prix,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  return bien;
}

async function creerAcquereurDeTest(suffixe: string, budgetMax = 400000) {
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Reprise ${suffixe}`,
    email: `test-réel-reprise-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return acquereur;
}

// Crée un événement + exécution "à traiter" SANS jamais appeler traiterExecutionsEnAttente — simule
// fidèlement un process interrompu avant tout traitement (Cas A/B de l'audit : indiscernable côté
// DB, la ligne reste `a_traiter`, rien d'autre n'existe).
async function creerExecutionATraiterDeTest(suffixe: string, prixBien = 300000, budgetMax = 400000) {
  const acquereur = await creerAcquereurDeTest(suffixe, budgetMax);
  const bien = await creerBienDeTest(suffixe, prixBien);
  const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
    emettreEvenementEtPreparerExecutions(
      { typeEvenement: "compatibilite_bien_acquereur_devenue_compatible", bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1 },
      tx
    )
  );
  return { bien, acquereur, executionId: idsExecutionsATraiter[0] };
}

async function tachesPourAcquereur(acquereurId: string) {
  return getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, acquereurId));
}

describe("reprendreExecutionsBloquees — sélection et traitement", () => {
  it("reprend une exécution a_traiter jamais traitée : exactement 1 tâche, reussie, tentative incrémentée", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { acquereur, executionId } = await creerExecutionATraiterDeTest("SEL1");

    const resultat = await reprendreExecutionsBloquees();
    expect(resultat.examinees).toBeGreaterThanOrEqual(1);
    expect(resultat.traitees).toBeGreaterThanOrEqual(1);

    const execution = await getExecutionAutomatisationById(executionId);
    expect(execution?.reussieLe).toBeDefined();
    expect(execution?.echoueeLe).toBeUndefined();
    expect(execution?.nombreTentatives).toBe(1);
    expect(execution?.derniereTentativeLe).toBeDefined();
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(1);

    await definirActivationAutomatisation(REGLE, false);
  });

  it("une exécution déjà reussie n'est jamais retouchée par un appel suivant", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { acquereur, executionId } = await creerExecutionATraiterDeTest("SEL2");
    await reprendreExecutionsBloquees();
    const apresPremierAppel = await getExecutionAutomatisationById(executionId);
    expect(apresPremierAppel?.nombreTentatives).toBe(1);

    await reprendreExecutionsBloquees();
    const apresSecondAppel = await getExecutionAutomatisationById(executionId);
    expect(apresSecondAppel?.nombreTentatives).toBe(1); // jamais réincrémentée
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(1); // jamais une seconde tâche

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("reprendreExecutionsBloquees — idempotence et concurrence", () => {
  it("double appel séquentiel sur la même exécution : toujours 1 tâche", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { acquereur } = await creerExecutionATraiterDeTest("IDEMP1");

    await reprendreExecutionsBloquees();
    await reprendreExecutionsBloquees();

    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(1);
    await definirActivationAutomatisation(REGLE, false);
  });

  it("deux appels réellement concurrents sur la même exécution : toujours 1 tâche maximum", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { acquereur } = await creerExecutionATraiterDeTest("CONC1");

    await Promise.all([reprendreExecutionsBloquees(), reprendreExecutionsBloquees()]);

    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(1);
    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("reprendreExecutionsBloquees — plafond de tentatives", () => {
  it("une exécution ayant déjà atteint le plafond devient terminale (echouee) sans nouvelle tentative de traitement", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { acquereur, executionId } = await creerExecutionATraiterDeTest("PLAFOND1");

    // Simule des tentatives de reprise déjà comptabilisées (crashs répétés) sans jamais avoir
    // atteint le plafond — pose directement le compteur à sa valeur maximale légitime.
    await getDb()
      .update(executionsAutomatisation)
      .set({ nombreTentatives: MAX_TENTATIVES_AUTOMATISATION })
      .where(eq(executionsAutomatisation.id, executionId!));

    const resultat = await reprendreExecutionsBloquees();
    expect(resultat.plafondAtteint).toBeGreaterThanOrEqual(1);

    const execution = await getExecutionAutomatisationById(executionId!);
    expect(execution?.echoueeLe).toBeDefined();
    expect(execution?.reussieLe).toBeUndefined();
    expect(execution?.erreurTechnique).toContain("Nombre maximal de tentatives");
    expect(execution?.nombreTentatives).toBe(MAX_TENTATIVES_AUTOMATISATION + 1);
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(0); // jamais traitée malgré le plafond

    // Un appel suivant ne la retouche plus (devenue terminale) : compteur inchangé.
    await reprendreExecutionsBloquees();
    const executionApres = await getExecutionAutomatisationById(executionId!);
    expect(executionApres?.nombreTentatives).toBe(MAX_TENTATIVES_AUTOMATISATION + 1);

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("reprendreExecutionsBloquees — undefined reste un succès, jamais repris", () => {
  it("effet devenu inutile (paire incompatible) : reussie sans tâche, jamais retentée", async () => {
    await definirActivationAutomatisation(REGLE, true);
    // budgetMax très inférieur au prix du bien -> incompatible -> construireTache() retourne undefined.
    const { acquereur, executionId } = await creerExecutionATraiterDeTest("UNDEF1", 900000, 200000);

    await reprendreExecutionsBloquees();
    const execution = await getExecutionAutomatisationById(executionId);
    expect(execution?.reussieLe).toBeDefined();
    expect(execution?.tacheId).toBeUndefined();
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(0);

    // Second appel : rien à faire, jamais retraitée (déjà reussie).
    const resultatSuivant = await reprendreExecutionsBloquees();
    const executionApres = await getExecutionAutomatisationById(executionId);
    expect(executionApres?.nombreTentatives).toBe(execution?.nombreTentatives);
    void resultatSuivant;

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("reprendreExecutionsBloquees — erreur technique réelle, terminale", () => {
  it("creerTache échoue pendant la reprise : execution devient echouee, jamais retentée automatiquement ensuite", async () => {
    await definirActivationAutomatisation(REGLE, true);
    const { acquereur, executionId } = await creerExecutionATraiterDeTest("ERR1");
    creerTacheMock.mockRejectedValueOnce(new Error("échec simulé de creerTache (reprise)"));

    await reprendreExecutionsBloquees();
    const execution = await getExecutionAutomatisationById(executionId);
    expect(execution?.echoueeLe).toBeDefined();
    expect(execution?.reussieLe).toBeUndefined();
    expect(execution?.erreurTechnique).toContain("échec simulé");
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(0);

    // Appel suivant : la ligne echouee n'est plus sélectionnée, jamais un retry automatique.
    const resultatSuivant = await reprendreExecutionsBloquees();
    void resultatSuivant;
    const executionApres = await getExecutionAutomatisationById(executionId);
    expect(executionApres?.echoueeLe).toEqual(execution?.echoueeLe); // jamais retouchée

    await definirActivationAutomatisation(REGLE, false);
  });
});

describe("reprendreExecutionsBloquees — activation figée", () => {
  it("ne crée jamais d'exécution : ne travaille que sur des exécutions déjà matérialisées", async () => {
    await definirActivationAutomatisation(REGLE, false);
    const acquereur = await creerAcquereurDeTest("ACT1", 400000);
    const bien = await creerBienDeTest("ACT1", 300000);
    // Événement émis pendant que la règle est inactive : aucune exécution préparée (comportement
    // ADR-032 déjà garanti, non modifié par ADR-038).
    const { idsExecutionsATraiter } = await getDb().transaction((tx) =>
      emettreEvenementEtPreparerExecutions(
        { typeEvenement: "compatibilite_bien_acquereur_devenue_compatible", bienId: bien.id, acquereurId: acquereur.id, cycleCompatibilite: 1 },
        tx
      )
    );
    expect(idsExecutionsATraiter).toEqual([]);

    await reprendreExecutionsBloquees();
    expect(await tachesPourAcquereur(acquereur.id)).toHaveLength(0);
  });
});
