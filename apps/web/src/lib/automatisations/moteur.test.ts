import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

// Tests d'intégration réels (ADR-032) : ce fichier couvre les corrections n°6 (création de tâche +
// succès d'exécution atomiques, jamais de tâche orpheline en cas d'échec) et n°2 (scénario
// crash/pending : une exécution laissée "à traiter" reste traitable plus tard, jamais perdue), plus
// la garantie de double-submit bout en bout pour chacune des 4 règles V1.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// Le seul point du moteur qu'aucune donnée métier légitime ne peut faire échouer organiquement :
// chaque entité source référencée par evenements_metier est protégée de suppression tant que
// l'événement existe (ADR-032, correction n°5 — NO ACTION), donc creerTache ne peut jamais recevoir
// de clé étrangère "orpheline" en pratique. On simule donc directement un échec de creerTache par
// mock ciblé, plutôt qu'en fabriquant un état de données impossible à atteindre en production.
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
  prospectsVendeurs: prospectsVendeursTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  taches: tachesTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { creerProspectVendeur, signerMandatProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");
const { getExecutionAutomatisationById } = await import("./executionAutomatisationRepository");
const { traiterExecutionsEnAttente } = await import("./moteur");
const { deriverEtatExecutionAutomatisation } = await import("@/types/automatisation");

const RÈGLES = [
  "suivi_apres_visite",
  "suivi_apres_rdv_estimation",
  "preparation_apres_mandat",
  "preparation_dossier_notaire_apres_compromis",
] as const;

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsProspectsCrees: string[] = [];
const idsTachesCrees: string[] = [];
// evenements_metier / executions_automatisation référencent leurs entités source sans cascade
// (ADR-032, correction n°5 — NO ACTION, append-only) : nettoyés AVANT les biens/acquéreurs/
// prospects, sinon la suppression de ces derniers échoue (violation de clé étrangère).
const idsEvenementsCrees: string[] = [];

afterAll(async () => {
  for (const code of RÈGLES) await definirActivationAutomatisation(code, false);
  if (idsTachesCrees.length > 0) {
    await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTachesCrees));
  }
  if (idsEvenementsCrees.length > 0) {
    await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvenementsCrees));
    await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenementsCrees));
  }
  for (const id of idsProspectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienEtAcquereurDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] MOTEUR-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Moteur ${suffixe}`,
    email: `test-réel-moteur-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return { bien, acquereur };
}

async function creerCompteRenduDeTest(suffixe: string) {
  const { bien, acquereur } = await creerBienEtAcquereurDeTest(suffixe);
  return enregistrerCompteRenduVisite({
    bienId: bien.id,
    acquereurId: acquereur.id,
    dateVisite: "2026-08-01",
    retour: "Visite de test",
    interet: "interesse",
  });
}

async function creerProspectDeTest(suffixe: string) {
  const prospect = await creerProspectVendeur({
    nom: `[test réel] Prospect moteur ${suffixe}`,
    prenom: undefined,
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
  return prospect;
}

describe("moteur — création de tâche + succès d'exécution atomiques", () => {
  it("traite une exécution à traiter : crée la tâche (origine automatique) et pose tacheId + reussieLe", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);
    const compteRendu = await creerCompteRenduDeTest("SUCCES");

    const resultat = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    idsEvenementsCrees.push(resultat.evenement!.id);
    expect(resultat.idsExecutionsATraiter).toHaveLength(1);

    await traiterExecutionsEnAttente(resultat.idsExecutionsATraiter);

    const execution = await getExecutionAutomatisationById(resultat.idsExecutionsATraiter[0]);
    expect(deriverEtatExecutionAutomatisation(execution!)).toBe("reussie");
    expect(execution!.tacheId).toBeDefined();
    idsTachesCrees.push(execution!.tacheId!);

    const [tache] = await getDb().select().from(tachesTable).where(eq(tachesTable.id, execution!.tacheId!));
    expect(tache.origine).toBe("automatique");
    expect(tache.origineCode).toBe("suivi_apres_visite");
    // ADR-041 : la règle cible désormais l'acquéreur, jamais le compte rendu.
    expect(tache.acquereurId).toBe(compteRendu.acquereurId);
    expect(tache.visiteId).toBeNull();

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });
});

describe("moteur — scénario crash/pending", () => {
  it("une exécution laissée 'à traiter' (jamais transmise juste après le commit) est traitée avec succès plus tard, sans duplication", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);
    const compteRendu = await creerCompteRenduDeTest("CRASH-PENDING");

    // Simule le crash : l'événement et l'exécution sont posés (comme dans la transaction métier),
    // mais `traiterExecutionsEnAttente` n'est volontairement PAS appelé ici — exactement l'état
    // dans lequel le process se retrouverait s'il s'arrêtait juste après le COMMIT.
    const resultat = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    idsEvenementsCrees.push(resultat.evenement!.id);
    const [executionId] = resultat.idsExecutionsATraiter;

    const avant = await getExecutionAutomatisationById(executionId);
    expect(deriverEtatExecutionAutomatisation(avant!)).toBe("a_traiter");

    // Reprise plus tard (ex. nouvelle requête, retraitement manuel) : traite désormais la ligne
    // laissée en attente.
    await traiterExecutionsEnAttente([executionId]);

    const apres = await getExecutionAutomatisationById(executionId);
    expect(deriverEtatExecutionAutomatisation(apres!)).toBe("reussie");
    expect(apres!.tacheId).toBeDefined();
    idsTachesCrees.push(apres!.tacheId!);

    // Un nouveau passage sur la même exécution déjà résolue ne doit jamais créer de seconde tâche
    // (verrouillage par les gardes IS NULL — la ligne est ignorée, plus rien à retraiter).
    await traiterExecutionsEnAttente([executionId]);
    const tachesPourAcquereur = await getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, compteRendu.acquereurId));
    expect(tachesPourAcquereur).toHaveLength(1);

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });
});

describe("moteur — échec de creerTache", () => {
  it("si creerTache échoue, aucune tâche n'est créée et l'exécution est marquée 'echouee', jamais 'reussie'", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);
    const compteRendu = await creerCompteRenduDeTest("ECHEC-CREER-TACHE");

    const resultat = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    idsEvenementsCrees.push(resultat.evenement!.id);
    const [executionId] = resultat.idsExecutionsATraiter;

    creerTacheMock.mockRejectedValueOnce(new Error("échec simulé de creerTache"));
    await traiterExecutionsEnAttente([executionId]);

    const execution = await getExecutionAutomatisationById(executionId);
    expect(deriverEtatExecutionAutomatisation(execution!)).toBe("echouee");
    expect(execution!.tacheId).toBeUndefined();
    expect(execution!.erreurTechnique).toContain("échec simulé");

    const tachesPourAcquereur = await getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, compteRendu.acquereurId));
    expect(tachesPourAcquereur).toHaveLength(0);

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });
});

describe("moteur — double-submit bout en bout, par règle", () => {
  it("suivi_apres_visite : une double émission du même événement ne produit qu'une seule tâche", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);
    const compteRendu = await creerCompteRenduDeTest("DOUBLE-SUBMIT-VISITE");

    const premiere = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    idsEvenementsCrees.push(premiere.evenement!.id);
    await traiterExecutionsEnAttente(premiere.idsExecutionsATraiter);

    // Second submit du même formulaire (ex. double clic / retry réseau) : même compte rendu, même
    // fait métier.
    const seconde = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    await traiterExecutionsEnAttente(seconde.idsExecutionsATraiter);

    const taches = await getDb().select().from(tachesTable).where(eq(tachesTable.acquereurId, compteRendu.acquereurId));
    expect(taches).toHaveLength(1);
    idsTachesCrees.push(taches[0].id);

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });

  it("suivi_apres_rdv_estimation : une double émission pour le même prospect ne produit qu'une seule tâche", async () => {
    await definirActivationAutomatisation("suivi_apres_rdv_estimation", true);
    const prospect = await creerProspectDeTest("DOUBLE-SUBMIT-RDV");

    const premiere = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "rdv_estimation_realise",
      prospectVendeurId: prospect.id,
    });
    idsEvenementsCrees.push(premiere.evenement!.id);
    await traiterExecutionsEnAttente(premiere.idsExecutionsATraiter);

    const seconde = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "rdv_estimation_realise",
      prospectVendeurId: prospect.id,
    });
    await traiterExecutionsEnAttente(seconde.idsExecutionsATraiter);

    const taches = await getDb().select().from(tachesTable).where(eq(tachesTable.prospectVendeurId, prospect.id));
    expect(taches).toHaveLength(1);
    idsTachesCrees.push(taches[0].id);

    await definirActivationAutomatisation("suivi_apres_rdv_estimation", false);
  });

  it("preparation_apres_mandat : une réémission directe de l'événement après signature ne produit pas de seconde tâche", async () => {
    await definirActivationAutomatisation("preparation_apres_mandat", true);
    const prospect = await creerProspectDeTest("DOUBLE-SUBMIT-MANDAT");

    const resultat = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] MOTEUR-DOUBLE-SUBMIT-MANDAT",
      titre: "Bien signé de test",
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-09-01",
      caracteristiques: [],
      description: "",
    });
    idsBiensCrees.push(resultat!.bien.id);
    await traiterExecutionsEnAttente(resultat!.idsExecutionsATraiter);

    // L'événement a été émis à l'intérieur de signerMandatProspectVendeur (pas d'id retourné
    // directement) : on le retrouve par sa clé naturelle pour le nettoyage.
    const [evenementCree] = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(
        and(eq(evenementsMetierTable.typeEvenement, "mandat_signe"), eq(evenementsMetierTable.prospectVendeurId, prospect.id))
      );
    idsEvenementsCrees.push(evenementCree.id);

    // Réémission directe simulant un double submit au niveau du moteur d'événements lui-même,
    // indépendamment de la garde métier (déjà testée dans prospectVendeur.test.ts) qui empêche
    // normalement une seconde signature.
    const rejeu = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "mandat_signe",
      prospectVendeurId: prospect.id,
    });
    expect(rejeu.evenement).toBeUndefined();
    await traiterExecutionsEnAttente(rejeu.idsExecutionsATraiter);

    const taches = await getDb().select().from(tachesTable).where(eq(tachesTable.bienId, resultat!.bien.id));
    expect(taches).toHaveLength(1);
    idsTachesCrees.push(taches[0].id);

    await definirActivationAutomatisation("preparation_apres_mandat", false);
  });

  it("preparation_dossier_notaire_apres_compromis : une double émission pour le même compromis ne produit qu'une seule tâche", async () => {
    await definirActivationAutomatisation("preparation_dossier_notaire_apres_compromis", true);
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLE-SUBMIT-COMPROMIS");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });

    const premiere = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    idsEvenementsCrees.push(premiere.evenement!.id);
    await traiterExecutionsEnAttente(premiere.idsExecutionsATraiter);

    const seconde = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    await traiterExecutionsEnAttente(seconde.idsExecutionsATraiter);

    const taches = await getDb().select().from(tachesTable).where(eq(tachesTable.compromisId, compromis.id));
    expect(taches).toHaveLength(1);
    idsTachesCrees.push(taches[0].id);

    await definirActivationAutomatisation("preparation_dossier_notaire_apres_compromis", false);
  });
});
