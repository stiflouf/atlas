import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

// Tests d'intégration réels (ADR-032) : chaque scénario touche la vraie base Postgres, même style
// que compromis.test.ts / envoiEmailRepository.test.ts. Ce fichier couvre les corrections n°1 à 3
// de l'ADR : idempotence de l'événement (double émission, index partiel), idempotence de
// l'exécution (UNIQUE regleCode+evenementId) et activation figée au moment de l'événement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  prospectsVendeurs: prospectsVendeursTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { emettreEvenementEtPreparerExecutions } = await import("./evenementMetierRepository");
const { definirActivationAutomatisation } = await import("./configurationAutomatisationRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsProspectsCrees: string[] = [];
// evenements_metier / executions_automatisation référencent leurs entités source sans cascade
// (ADR-032, correction n°5 — NO ACTION, append-only) : ils doivent être nettoyés AVANT les biens/
// acquéreurs/prospects, sinon la suppression de ces derniers échoue (violation de clé étrangère).
const idsEvenementsCrees: string[] = [];

afterAll(async () => {
  for (const code of [
    "suivi_apres_visite",
    "suivi_apres_rdv_estimation",
    "preparation_dossier_notaire_apres_compromis",
  ] as const) {
    await definirActivationAutomatisation(code, false);
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
    reference: `[test réel] EVT-METIER-${suffixe}`,
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
    nom: `[test réel] Evt Métier ${suffixe}`,
    email: `test-réel-evt-metier-${suffixe}@example.com`,
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
    nom: `[test réel] Prospect évt métier ${suffixe}`,
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

async function creerCompromisDeTest(suffixe: string) {
  const { bien, acquereur } = await creerBienEtAcquereurDeTest(suffixe);
  return enregistrerCompromis({
    bienId: bien.id,
    acquereurId: acquereur.id,
    prixConvenu: 300000,
    dateSignature: "2026-08-01",
  });
}

describe("emettreEvenementEtPreparerExecutions — idempotence de l'événement (index unique partiel)", () => {
  it("visite_realisee : le second appel pour le même compte rendu ne crée pas de second événement", async () => {
    const compteRendu = await creerCompteRenduDeTest("VISITE-DOUBLE");

    const premier = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    expect(premier.evenement).toBeDefined();
    idsEvenementsCrees.push(premier.evenement!.id);

    const second = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    expect(second.evenement).toBeUndefined();
    expect(second.idsExecutionsATraiter).toEqual([]);

    const lignes = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(
        and(
          eq(evenementsMetierTable.typeEvenement, "visite_realisee"),
          eq(evenementsMetierTable.compteRenduVisiteId, compteRendu.id)
        )
      );
    expect(lignes).toHaveLength(1);
  });

  it("rdv_estimation_realise : le second appel pour le même prospect ne crée pas de second événement", async () => {
    const prospect = await creerProspectDeTest("RDV-DOUBLE");

    const premier = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "rdv_estimation_realise",
      prospectVendeurId: prospect.id,
    });
    expect(premier.evenement).toBeDefined();
    idsEvenementsCrees.push(premier.evenement!.id);

    const second = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "rdv_estimation_realise",
      prospectVendeurId: prospect.id,
    });
    expect(second.evenement).toBeUndefined();

    const lignes = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(
        and(
          eq(evenementsMetierTable.typeEvenement, "rdv_estimation_realise"),
          eq(evenementsMetierTable.prospectVendeurId, prospect.id)
        )
      );
    expect(lignes).toHaveLength(1);
  });

  it("compromis_signe : le second appel pour le même compromis ne crée pas de second événement", async () => {
    const compromis = await creerCompromisDeTest("COMPROMIS-DOUBLE");

    const premier = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    expect(premier.evenement).toBeDefined();
    idsEvenementsCrees.push(premier.evenement!.id);

    const second = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    expect(second.evenement).toBeUndefined();

    const lignes = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(
        and(eq(evenementsMetierTable.typeEvenement, "compromis_signe"), eq(evenementsMetierTable.compromisId, compromis.id))
      );
    expect(lignes).toHaveLength(1);
  });
});

describe("emettreEvenementEtPreparerExecutions — activation figée au moment de l'événement", () => {
  it("règle inactive au moment de l'événement : aucune exécution préparée, même après activation ultérieure de la règle", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", false);
    const compteRendu = await creerCompteRenduDeTest("ACTIVATION-INACTIVE");

    const resultat = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    expect(resultat.evenement).toBeDefined();
    idsEvenementsCrees.push(resultat.evenement!.id);
    expect(resultat.idsExecutionsATraiter).toEqual([]);

    // Activation ultérieure de la règle — ne doit jamais traiter rétroactivement l'événement déjà
    // survenu : aucune ligne d'exécution n'a été prévue pour lui, il n'en existera donc jamais.
    await definirActivationAutomatisation("suivi_apres_visite", true);

    const lignesExecution = await getDb()
      .select()
      .from(executionsAutomatisationTable)
      .where(
        and(
          eq(executionsAutomatisationTable.regleCode, "suivi_apres_visite"),
          eq(executionsAutomatisationTable.evenementId, resultat.evenement!.id)
        )
      );
    expect(lignesExecution).toHaveLength(0);

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });

  it("règle active au moment de l'événement : une exécution 'à traiter' est préparée pour elle", async () => {
    await definirActivationAutomatisation("suivi_apres_visite", true);
    const compteRendu = await creerCompteRenduDeTest("ACTIVATION-ACTIVE");

    const resultat = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "visite_realisee",
      compteRenduVisiteId: compteRendu.id,
    });
    idsEvenementsCrees.push(resultat.evenement!.id);
    expect(resultat.idsExecutionsATraiter).toHaveLength(1);

    const [ligneExecution] = await getDb()
      .select()
      .from(executionsAutomatisationTable)
      .where(eq(executionsAutomatisationTable.id, resultat.idsExecutionsATraiter[0]));
    expect(ligneExecution.regleCode).toBe("suivi_apres_visite");
    expect(ligneExecution.reussieLe).toBeNull();
    expect(ligneExecution.echoueeLe).toBeNull();

    await definirActivationAutomatisation("suivi_apres_visite", false);
  });
});

describe("executions_automatisation — idempotence de l'exécution (UNIQUE regleCode+evenementId)", () => {
  it("une insertion directe en double sur (regleCode, evenementId) est rejetée par la contrainte", async () => {
    const compromis = await creerCompromisDeTest("UNIQUE-EXECUTION");
    const { evenement } = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "compromis_signe",
      compromisId: compromis.id,
    });
    expect(evenement).toBeDefined();
    idsEvenementsCrees.push(evenement!.id);

    const [premiere] = await getDb()
      .insert(executionsAutomatisationTable)
      .values({ regleCode: "preparation_dossier_notaire_apres_compromis", evenementId: evenement!.id })
      .returning();
    expect(premiere).toBeDefined();

    await expect(
      getDb()
        .insert(executionsAutomatisationTable)
        .values({ regleCode: "preparation_dossier_notaire_apres_compromis", evenementId: evenement!.id })
    ).rejects.toThrow();
  });
});

describe("emettreEvenementEtPreparerExecutions — idempotence du cycle temporel (ADR-033)", () => {
  it("même ancre rejouée pour le même prospect : refusée ; nouvelle ancre : acceptée (test obligatoire, correction n°1)", async () => {
    const prospect = await creerProspectDeTest("CYCLE-INACTIVITE");
    const ancreA = new Date("2026-01-01T10:00:00Z");
    const ancreB = new Date("2026-02-01T10:00:00Z");

    const premier = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "inactivite_prospect_vendeur",
      prospectVendeurId: prospect.id,
      ancreCycle: ancreA,
    });
    expect(premier.evenement).toBeDefined();
    expect(premier.evenement!.ancreCycle).toBe(ancreA.toISOString());
    idsEvenementsCrees.push(premier.evenement!.id);

    // Même ancre rejouée (double submit du scan, ou deux scans concurrents) : refusée.
    const rejeuMemeAncre = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "inactivite_prospect_vendeur",
      prospectVendeurId: prospect.id,
      ancreCycle: ancreA,
    });
    expect(rejeuMemeAncre.evenement).toBeUndefined();

    // Nouvelle ancre (un vrai nouveau contact a eu lieu entre-temps, puis un nouveau silence) :
    // acceptée — un nouveau cycle, jamais bloqué par l'ancien.
    const nouvelleAncre = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "inactivite_prospect_vendeur",
      prospectVendeurId: prospect.id,
      ancreCycle: ancreB,
    });
    expect(nouvelleAncre.evenement).toBeDefined();
    expect(nouvelleAncre.evenement!.ancreCycle).toBe(ancreB.toISOString());
    idsEvenementsCrees.push(nouvelleAncre.evenement!.id);

    const lignes = await getDb()
      .select()
      .from(evenementsMetierTable)
      .where(
        and(
          eq(evenementsMetierTable.typeEvenement, "inactivite_prospect_vendeur"),
          eq(evenementsMetierTable.prospectVendeurId, prospect.id)
        )
      );
    expect(lignes).toHaveLength(2);
  });

  it("l'ancien index prospect ponctuel (rdv_estimation_realise) n'interfère jamais avec le cycle temporel du même prospect", async () => {
    const prospect = await creerProspectDeTest("CYCLE-VS-PONCTUEL");
    const ancre = new Date("2026-03-01T10:00:00Z");

    const ponctuel = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "rdv_estimation_realise",
      prospectVendeurId: prospect.id,
    });
    expect(ponctuel.evenement).toBeDefined();
    idsEvenementsCrees.push(ponctuel.evenement!.id);

    const cyclique = await emettreEvenementEtPreparerExecutions({
      typeEvenement: "inactivite_prospect_vendeur",
      prospectVendeurId: prospect.id,
      ancreCycle: ancre,
    });
    expect(cyclique.evenement).toBeDefined();
    idsEvenementsCrees.push(cyclique.evenement!.id);
  });
});
