import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// Test d'intégration sur des agrégats globaux (pas de filtre par bienId comme les autres
// repositories) : impossible d'isoler ces requêtes des autres suites qui créent/suppriment leurs
// propres lignes réelles en parallèle dans les mêmes tables (offres/compromis/
// comptes_rendus_visite). Stratégie retenue plutôt que d'inventer une infrastructure de test
// dédiée (schéma isolé, transactions par test) non utilisée ailleurs dans ce projet :
// - comptages/sommes : delta avant/après (avant + delta connu = après), robuste tant que rien
//   d'autre ne change strictement entre les deux lectures (fenêtre étroite).
// - séries mensuelles : dates délibérément situées en 2031 (année qu'aucune autre donnée, réelle
//   ou de test, n'utilise), pour filtrer l'entrée exacte sans dépendre de l'état global.
// - moyennes (AVG global, non additif) : égalité avant/après pour prouver qu'une donnée ne
//   contribue PAS (ex. vente sans CR), ou vérification "devient définie" pour prouver qu'une
//   donnée contribue bien, plutôt qu'une prédiction précise de la nouvelle moyenne globale.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  compromis: compromisTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  remuneration: remunerationTable,
} = await import("@/db/schema");
const { creerBien, archiverBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { enregistrerOffre, changerStatutOffre } = await import("./offreRepository");
const { enregistrerCompromis, marquerCompromisAnnule, marquerCompromisRealise } = await import(
  "./compromisRepository"
);
const { enregistrerCompteRenduVisite } = await import("./compteRenduVisiteRepository");
const { lierVisiteAOffre } = await import("./offreVisiteRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("./remunerationRepository");
const {
  chargerResultats,
  chargerPipeline,
  chargerActivite,
  chargerDelais,
  chargerPertes,
  chargerRemuneration,
  chargerProjectionAnnuelle,
} = await import("./dashboardRepository");

// chargerProjectionAnnuelle() s'appuie sur CURRENT_DATE côté Postgres, jamais sur l'horloge Node —
// les dates de fixture du describe ADR-022 ci-dessous sont donc dérivées de cette même date lue en
// base une seule fois, pour ne jamais risquer un décalage jour/année entre le process Node qui
// construit les fixtures et le serveur qui évalue les requêtes (fuseau horaire différent,
// franchissement de minuit entre les deux lectures).
const [{ aujourdhui }] = await getDb().execute<{ aujourdhui: string }>(
  sql`select to_char(current_date, 'YYYY-MM-DD') as aujourdhui`
);
function decalerJours(dateIso: string, delta: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const anneeCourante = Number(aujourdhui.slice(0, 4));
const anneeDifferente = anneeCourante - 5;
const hier = decalerJours(aujourdhui, -1);
const demain = decalerJours(aujourdhui, 1);
const finAnnee = `${anneeCourante}-12-31`;
const anneeSuivante = `${anneeCourante + 1}-01-15`; // après le 31/12, hors fenêtre "restant"

const idsCompromisCrees: string[] = [];
const idsOffresCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsRemunerationCrees: string[] = [];

afterAll(async () => {
  for (const id of idsRemunerationCrees) {
    await getDb().delete(remunerationTable).where(eq(remunerationTable.id, id));
  }
  for (const id of idsComptesRendusCrees) {
    await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  }
  for (const id of idsCompromisCrees) {
    await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  }
  for (const id of idsOffresCrees) {
    await getDb().delete(offresTable).where(eq(offresTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerBienEtAcquereurDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] DASHBOARD-${suffixe}`,
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
    nom: `[test réel] Dashboard ${suffixe}`,
    email: `test-réel-dashboard-${suffixe}@example.com`,
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

async function creerCompteRendu(bienId: string, acquereurId: string, dateVisite: string) {
  const cr = await enregistrerCompteRenduVisite({
    bienId,
    acquereurId,
    dateVisite,
    retour: "Retour de test.",
    interet: "interesse",
  });
  idsComptesRendusCrees.push(cr.id);
  return cr;
}

describe("dashboardRepository — chargerResultats", () => {
  it("compte une vente fraîchement realise et son volume (delta avant/après)", async () => {
    const avant = await chargerResultats();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("RESULTATS-001");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 111000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-08-15");

    const apres = await chargerResultats();

    expect(apres.nombreVentes).toBe(avant.nombreVentes + 1);
    expect(apres.volumeVendu).toBe(avant.volumeVendu + 111000);
  });

  it("inclut une vente sur un bien archivé", async () => {
    const avant = await chargerResultats();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("RESULTATS-002");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 222000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-08-15");
    await archiverBien(bien.id);

    const apres = await chargerResultats();

    expect(apres.nombreVentes).toBe(avant.nombreVentes + 1);
    expect(apres.volumeVendu).toBe(avant.volumeVendu + 222000);
  });

  it("realiseParMois regroupe par mois de dateActeReelle (mois distinctif, non ambigu)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("RESULTATS-003");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 333000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2031-03-15");

    const { realiseParMois } = await chargerResultats();

    expect(realiseParMois).toContainEqual({ mois: "2031-03", montant: 333000 });
  });

  it("tauxCompromisVente ignore les compromis en_cours (égalité avant/après)", async () => {
    const avant = await chargerResultats();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("RESULTATS-004");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 100000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);

    const apres = await chargerResultats();

    expect(apres.tauxCompromisVente).toBe(avant.tauxCompromisVente);
  });
});

describe("dashboardRepository — chargerPipeline", () => {
  it("exclut un compromis en_cours sur un bien archivé (égalité avant/après)", async () => {
    const avant = await chargerPipeline();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PIPELINE-001");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 444000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await archiverBien(bien.id);

    const apres = await chargerPipeline();

    expect(apres.compromisEnCours).toBe(avant.compromisEnCours);
    expect(apres.volumeSousCompromis).toBe(avant.volumeSousCompromis);
  });

  it("inclut un compromis en_cours sur un bien non archivé (delta avant/après)", async () => {
    const avant = await chargerPipeline();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PIPELINE-002");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 555000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);

    const apres = await chargerPipeline();

    expect(apres.compromisEnCours).toBe(avant.compromisEnCours + 1);
    expect(apres.volumeSousCompromis).toBe(avant.volumeSousCompromis + 555000);
  });

  it("pipelinePrevisionnelParMois regroupe par mois de dateActe (mois distinctif)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PIPELINE-003");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 666000,
      dateSignature: "2026-08-01",
      dateActe: "2031-04-20",
    });
    idsCompromisCrees.push(c.id);

    const { pipelinePrevisionnelParMois } = await chargerPipeline();

    expect(pipelinePrevisionnelParMois).toContainEqual({ mois: "2031-04", montant: 666000 });
  });

  it("exclut une offre en_cours sur un bien archivé (égalité avant/après)", async () => {
    const avant = await chargerPipeline();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PIPELINE-004");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(o.id);
    await archiverBien(bien.id);

    const apres = await chargerPipeline();

    expect(apres.offresEnCours).toBe(avant.offresEnCours);
    expect(apres.volumeOffresEnCours).toBe(avant.volumeOffresEnCours);
  });

  it("inclut une offre en_cours sur un bien non archivé (delta avant/après)", async () => {
    const avant = await chargerPipeline();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PIPELINE-005");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 320000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(o.id);

    const apres = await chargerPipeline();

    expect(apres.offresEnCours).toBe(avant.offresEnCours + 1);
    expect(apres.volumeOffresEnCours).toBe(avant.volumeOffresEnCours + 320000);
  });
});

describe("dashboardRepository — chargerActivite", () => {
  it("compte les visites/offres/compromis enregistrés (delta avant/après)", async () => {
    const avant = await chargerActivite();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACTIVITE-001");
    await creerCompteRendu(bien.id, acquereur.id, "2026-08-01");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-02",
    });
    idsOffresCrees.push(o.id);
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-03",
    });
    idsCompromisCrees.push(c.id);

    const apres = await chargerActivite();

    expect(apres.visitesEnregistrees).toBe(avant.visitesEnregistrees + 1);
    expect(apres.offresEnregistrees).toBe(avant.offresEnregistrees + 1);
    expect(apres.compromisEnregistres).toBe(avant.compromisEnregistres + 1);
  });

  it("moyenneVisitesAvantVente : une vente realise SANS compte rendu ne modifie jamais la moyenne (jamais comptée comme 0)", async () => {
    const avant = await chargerActivite();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACTIVITE-002");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-10",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-09-01");
    // Aucun compte rendu créé pour ce couple bien/acquéreur.

    const apres = await chargerActivite();

    expect(apres.moyenneVisitesAvantVente).toBe(avant.moyenneVisitesAvantVente);
  });

  it("moyenneVisitesAvantVente : une vente realise avec au moins un compte rendu devient définie (jamais undefined)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACTIVITE-003");
    await creerCompteRendu(bien.id, acquereur.id, "2026-08-01");
    await creerCompteRendu(bien.id, acquereur.id, "2026-08-05");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-10",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-09-01");

    const { moyenneVisitesAvantVente } = await chargerActivite();

    expect(moyenneVisitesAvantVente).toBeTypeOf("number");
    expect(moyenneVisitesAvantVente).toBeGreaterThan(0);
  });

  it("moyenneVisitesAvantVente : ne compte que les comptes rendus antérieurs à dateSignature", async () => {
    // Deux ventes "équivalentes" (2 CR avant signature chacune) : l'une (E) n'a que ces 2 CR,
    // l'autre (D) a en plus un 3e CR postérieur à la signature. Si l'implémentation comptait
    // aussi les CR postérieurs, D contribuerait "3" et E "2" — la moyenne globale différerait
    // selon laquelle des deux est ajoutée. En comptant correctement, les deux contribuent "2" :
    // ajouter D après E ne doit rien changer à la moyenne.
    const { bien: bienE, acquereur: acqE } = await creerBienEtAcquereurDeTest("ACTIVITE-004-E");
    await creerCompteRendu(bienE.id, acqE.id, "2026-08-01");
    await creerCompteRendu(bienE.id, acqE.id, "2026-08-05");
    const compromisE = await enregistrerCompromis({
      bienId: bienE.id,
      acquereurId: acqE.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-10",
    });
    idsCompromisCrees.push(compromisE.id);
    await marquerCompromisRealise(compromisE.id, "2026-09-01");

    const apresE = await chargerActivite();

    const { bien: bienD, acquereur: acqD } = await creerBienEtAcquereurDeTest("ACTIVITE-004-D");
    await creerCompteRendu(bienD.id, acqD.id, "2026-08-01");
    await creerCompteRendu(bienD.id, acqD.id, "2026-08-05");
    await creerCompteRendu(bienD.id, acqD.id, "2026-08-20"); // postérieur à dateSignature
    const compromisD = await enregistrerCompromis({
      bienId: bienD.id,
      acquereurId: acqD.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-10",
    });
    idsCompromisCrees.push(compromisD.id);
    await marquerCompromisRealise(compromisD.id, "2026-09-01");

    const apresD = await chargerActivite();

    expect(apresD.moyenneVisitesAvantVente).toBe(apresE.moyenneVisitesAvantVente);
  });

  it("tauxVisiteOffre : une visite SANS lien vers une offre ne contribue jamais au numérateur", async () => {
    const avant = await chargerActivite();
    // Numérateur reconstruit algébriquement (avant.tauxVisiteOffre est une moyenne globale, non
    // additive) — voir le principe documenté en tête de fichier.
    const numerateurAvant = (avant.tauxVisiteOffre ?? 0) * avant.visitesEnregistrees;

    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACTIVITE-005-SANS-LIEN");
    await creerCompteRendu(bien.id, acquereur.id, "2026-08-01");
    // Aucune offre créée, aucun lien posé pour cette visite.

    const apres = await chargerActivite();

    expect(apres.visitesEnregistrees).toBe(avant.visitesEnregistrees + 1);
    expect(apres.tauxVisiteOffre).toBeCloseTo(numerateurAvant / apres.visitesEnregistrees, 10);
  });

  it("tauxVisiteOffre : une visite explicitement liée à une offre contribue au numérateur", async () => {
    const avant = await chargerActivite();
    const numerateurAvant = (avant.tauxVisiteOffre ?? 0) * avant.visitesEnregistrees;

    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACTIVITE-006-AVEC-LIEN");
    const cr = await creerCompteRendu(bien.id, acquereur.id, "2026-08-01");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-10",
    });
    idsOffresCrees.push(o.id);
    await lierVisiteAOffre(o.id, cr.id);

    const apres = await chargerActivite();

    expect(apres.visitesEnregistrees).toBe(avant.visitesEnregistrees + 1);
    expect(apres.tauxVisiteOffre).toBeCloseTo((numerateurAvant + 1) / apres.visitesEnregistrees, 10);
  });
});

describe("dashboardRepository — chargerDelais", () => {
  it("delaiMoyenOffreCompromisJours exclut un compromis direct sans offreId (égalité avant/après)", async () => {
    const avant = await chargerDelais();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-001");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-10",
    });
    idsCompromisCrees.push(c.id);

    const apres = await chargerDelais();

    expect(apres.delaiMoyenOffreCompromisJours).toBe(avant.delaiMoyenOffreCompromisJours);
  });

  it("delaiMoyenOffreCompromisJours devient défini pour un compromis lié à une offre acceptée", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-002");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(o.id);
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: o.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-11",
    });
    idsCompromisCrees.push(c.id);

    const { delaiMoyenOffreCompromisJours } = await chargerDelais();

    expect(delaiMoyenOffreCompromisJours).toBeTypeOf("number");
  });

  it("delaiMoyenCompromisActeJours devient défini pour une vente réalisée", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-003");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-08-20");

    const { delaiMoyenCompromisActeJours } = await chargerDelais();

    expect(delaiMoyenCompromisActeJours).toBeTypeOf("number");
  });

  it("delaiMoyenVisiteOffreJours reste inchangé pour une visite et une offre non liées entre elles (égalité avant/après)", async () => {
    const avant = await chargerDelais();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-005");
    await creerCompteRendu(bien.id, acquereur.id, "2026-08-01");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-10",
    });
    idsOffresCrees.push(o.id);
    // Aucun lien posé entre cette visite et cette offre.

    const apres = await chargerDelais();

    expect(apres.delaiMoyenVisiteOffreJours).toBe(avant.delaiMoyenVisiteOffreJours);
  });

  it("delaiMoyenVisiteOffreJours devient défini pour une paire visite/offre explicitement liée", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-006");
    const cr = await creerCompteRendu(bien.id, acquereur.id, "2026-08-01");
    const o = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-10",
    });
    idsOffresCrees.push(o.id);
    await lierVisiteAOffre(o.id, cr.id);

    const { delaiMoyenVisiteOffreJours } = await chargerDelais();

    expect(delaiMoyenVisiteOffreJours).toBeTypeOf("number");
    expect(delaiMoyenVisiteOffreJours).toBeGreaterThanOrEqual(0);
  });
});

describe("dashboardRepository — chargerPertes (ADR-020)", () => {
  it("compte et somme les offres refusées/retirées (delta avant/après)", async () => {
    const avant = await chargerPertes();
    const { bien: bienR, acquereur: acqR } = await creerBienEtAcquereurDeTest("PERTES-001-REFUSEE");
    const offreRefusee = await enregistrerOffre({
      bienId: bienR.id,
      acquereurId: acqR.id,
      montant: 111000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offreRefusee.id);
    await changerStatutOffre(offreRefusee.id, {
      statut: "refusee",
      dateDecision: "2026-08-05",
      motifPerte: "desaccord_prix",
    });

    const { bien: bienT, acquereur: acqT } = await creerBienEtAcquereurDeTest("PERTES-002-RETIREE");
    const offreRetiree = await enregistrerOffre({
      bienId: bienT.id,
      acquereurId: acqT.id,
      montant: 222000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offreRetiree.id);
    await changerStatutOffre(offreRetiree.id, {
      statut: "retiree",
      dateDecision: "2026-08-06",
      motifPerte: "acquereur_se_retire",
    });

    const apres = await chargerPertes();

    expect(apres.offresRefusees).toBe(avant.offresRefusees + 1);
    expect(apres.offresRetirees).toBe(avant.offresRetirees + 1);
    expect(apres.volumeOffresPerdues).toBe(avant.volumeOffresPerdues + 111000 + 222000);
  });

  it("compte et somme les compromis annulés (delta avant/après)", async () => {
    const avant = await chargerPertes();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PERTES-003");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 777000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisAnnule(c.id, "2026-08-10", "financement_refuse");

    const apres = await chargerPertes();

    expect(apres.compromisAnnules).toBe(avant.compromisAnnules + 1);
    expect(apres.volumeCompromisAnnules).toBe(avant.volumeCompromisAnnules + 777000);
  });

  it("pertesOffresParMotif/pertesCompromisParMotif : une perte avec motif renseigné contribue à sa catégorie", async () => {
    const { bien: bienO, acquereur: acqO } = await creerBienEtAcquereurDeTest("PERTES-004-OFFRE");
    const avant = await chargerPertes();
    const nombreAvantOffre =
      avant.pertesOffresParMotif.find((p) => p.motif === "juridique_administratif")?.nombre ?? 0;
    const offre = await enregistrerOffre({
      bienId: bienO.id,
      acquereurId: acqO.id,
      montant: 130000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, {
      statut: "refusee",
      dateDecision: "2026-08-05",
      motifPerte: "juridique_administratif",
    });

    const { bien: bienC, acquereur: acqC } = await creerBienEtAcquereurDeTest("PERTES-005-COMPROMIS");
    const nombreAvantCompromis =
      avant.pertesCompromisParMotif.find((p) => p.motif === "delai_calendrier")?.nombre ?? 0;
    const c = await enregistrerCompromis({
      bienId: bienC.id,
      acquereurId: acqC.id,
      prixConvenu: 140000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisAnnule(c.id, "2026-08-12", "delai_calendrier");

    const apres = await chargerPertes();

    expect(apres.pertesOffresParMotif.find((p) => p.motif === "juridique_administratif")?.nombre).toBe(
      nombreAvantOffre + 1
    );
    expect(apres.pertesCompromisParMotif.find((p) => p.motif === "delai_calendrier")?.nombre).toBe(
      nombreAvantCompromis + 1
    );
  });

  it("pertesOffresParMois/pertesCompromisParMois regroupent par mois de dateDecision/dateAnnulation (mois distinctif)", async () => {
    const { bien: bienO, acquereur: acqO } = await creerBienEtAcquereurDeTest("PERTES-006-OFFRE");
    const offre = await enregistrerOffre({
      bienId: bienO.id,
      acquereurId: acqO.id,
      montant: 150000,
      dateOffre: "2031-05-01",
    });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, {
      statut: "retiree",
      dateDecision: "2031-05-15",
      motifPerte: "autre",
    });

    const { bien: bienC, acquereur: acqC } = await creerBienEtAcquereurDeTest("PERTES-007-COMPROMIS");
    const c = await enregistrerCompromis({
      bienId: bienC.id,
      acquereurId: acqC.id,
      prixConvenu: 160000,
      dateSignature: "2031-06-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisAnnule(c.id, "2031-06-20", "autre");

    const { pertesOffresParMois, pertesCompromisParMois } = await chargerPertes();

    expect(pertesOffresParMois).toContainEqual({ mois: "2031-05", montant: 150000 });
    expect(pertesCompromisParMois).toContainEqual({ mois: "2031-06", montant: 160000 });
  });

  it("une perte SANS date ni motif (ligne historique simulée) compte dans les totaux par étape mais jamais dans les répartitions par motif ou par mois — aucun backfill, aucune reclassification (ADR-020)", async () => {
    const avant = await chargerPertes();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PERTES-008-HISTORIQUE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 999000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    // Simule une ligne créée avant ADR-020 : statut final posé directement en base, sans passer
    // par changerStatutOffre — donc sans dateDecision ni motifPerte.
    await getDb().update(offresTable).set({ statut: "refusee" }).where(eq(offresTable.id, offre.id));

    const apres = await chargerPertes();

    expect(apres.offresRefusees).toBe(avant.offresRefusees + 1);
    expect(apres.volumeOffresPerdues).toBe(avant.volumeOffresPerdues + 999000);
    const sommeNombreAvant = avant.pertesOffresParMotif.reduce((acc, p) => acc + p.nombre, 0);
    const sommeNombreApres = apres.pertesOffresParMotif.reduce((acc, p) => acc + p.nombre, 0);
    expect(sommeNombreApres).toBe(sommeNombreAvant);
    expect(apres.pertesOffresParMois).toEqual(avant.pertesOffresParMois);
  });
});

describe("dashboardRepository — chargerRemuneration (ADR-021)", () => {
  it("remunerationPrevisionnelleCentimes exclut un compromis en_cours sur un bien archivé (égalité avant/après)", async () => {
    const avant = await chargerRemuneration();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REMUNERATION-001");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 1000000 });
    idsRemunerationCrees.push(r.id);
    await archiverBien(bien.id);

    const apres = await chargerRemuneration();

    expect(apres.remunerationPrevisionnelleCentimes).toBe(avant.remunerationPrevisionnelleCentimes);
  });

  it("remunerationPrevisionnelleCentimes inclut un compromis en_cours sur un bien non archivé (delta avant/après)", async () => {
    const avant = await chargerRemuneration();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REMUNERATION-002");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 1500000 });
    idsRemunerationCrees.push(r.id);

    const apres = await chargerRemuneration();

    expect(apres.remunerationPrevisionnelleCentimes).toBe((avant.remunerationPrevisionnelleCentimes ?? 0) + 1500000);
    expect(apres.nombreRemunerationsPrevisionnellesRenseignees).toBe(
      avant.nombreRemunerationsPrevisionnellesRenseignees + 1
    );
    expect(apres.nombreCompromisEnCoursEligibles).toBe(avant.nombreCompromisEnCoursEligibles + 1);
  });

  it("un compromis en_cours sans ligne remuneration augmente le dénominateur mais pas le numérateur de couverture (inconnu ≠ zéro)", async () => {
    const avant = await chargerRemuneration();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REMUNERATION-003");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    // Aucune ligne remuneration créée pour ce compromis.

    const apres = await chargerRemuneration();

    expect(apres.nombreCompromisEnCoursEligibles).toBe(avant.nombreCompromisEnCoursEligibles + 1);
    expect(apres.nombreRemunerationsPrevisionnellesRenseignees).toBe(
      avant.nombreRemunerationsPrevisionnellesRenseignees
    );
    expect(apres.remunerationPrevisionnelleCentimes).toBe(avant.remunerationPrevisionnelleCentimes);
  });

  it("une vente realise sur un bien archivé reste comptée dans les métriques 'vente finalisée' (archivage commercial ≠ clôture du suivi financier, ADR-021)", async () => {
    const avant = await chargerRemuneration();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REMUNERATION-004");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-09-01");
    const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 800000 });
    idsRemunerationCrees.push(r.id);
    await archiverBien(bien.id);

    const apres = await chargerRemuneration();

    expect(apres.remunerationVenteFinaliseeNonEncaisseeCentimes).toBe(
      (avant.remunerationVenteFinaliseeNonEncaisseeCentimes ?? 0) + 800000
    );
    expect(apres.nombreVentesFinalisees).toBe(avant.nombreVentesFinalisees + 1);
    expect(apres.nombreRemunerationsVentesFinaliseesRenseignees).toBe(
      avant.nombreRemunerationsVentesFinaliseesRenseignees + 1
    );
  });

  it("une même ligne encaissée n'apparaît que dans remunerationEncaisseeCentimes, jamais aussi dans remunerationVenteFinaliseeNonEncaisseeCentimes (états mutuellement exclusifs)", async () => {
    const avant = await chargerRemuneration();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REMUNERATION-005");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-09-01");
    const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 900000 });
    idsRemunerationCrees.push(r.id);
    await marquerRemunerationEncaissee(c.id, "2026-09-20");

    const apres = await chargerRemuneration();

    expect(apres.remunerationEncaisseeCentimes).toBe((avant.remunerationEncaisseeCentimes ?? 0) + 900000);
    expect(apres.remunerationVenteFinaliseeNonEncaisseeCentimes).toBe(
      avant.remunerationVenteFinaliseeNonEncaisseeCentimes
    );
  });

  it("remunerationEncaisseeParMoisCentimes regroupe par mois de dateEncaissementReelle (mois distinctif)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REMUNERATION-006");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await marquerCompromisRealise(c.id, "2026-09-01");
    const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 700000 });
    idsRemunerationCrees.push(r.id);
    await marquerRemunerationEncaissee(c.id, "2031-07-10");

    const { remunerationEncaisseeParMoisCentimes } = await chargerRemuneration();

    expect(remunerationEncaisseeParMoisCentimes).toContainEqual({ mois: "2031-07", montantCentimes: 700000 });
  });
});

describe("dashboardRepository — chargerProjectionAnnuelle (ADR-022)", () => {
  it("annee correspond à l'année civile en cours côté serveur", async () => {
    const { annee } = await chargerProjectionAnnuelle();
    expect(annee).toBe(anneeCourante);
  });

  it("ventilationMensuelle contient toujours 12 mois consécutifs, janvier à décembre, zero-remplis", async () => {
    const { ventilationMensuelle } = await chargerProjectionAnnuelle();

    expect(ventilationMensuelle).toHaveLength(12);
    expect(ventilationMensuelle.map((m) => m.mois)).toEqual(
      Array.from({ length: 12 }, (_, i) => `${anneeCourante}-${String(i + 1).padStart(2, "0")}`)
    );
    for (const mois of ventilationMensuelle) {
      expect(mois.previsionnelCentimes).toBeTypeOf("number");
      expect(mois.finaliseNonEncaisseCentimes).toBeTypeOf("number");
      expect(mois.encaisseCentimes).toBeTypeOf("number");
    }
  });

  describe("encaisseDepuisJanvierCentimes", () => {
    it("inclut une rémunération encaissée cette année (delta avant/après)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-001");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 111100 });
      idsRemunerationCrees.push(r.id);
      await marquerRemunerationEncaissee(c.id, aujourdhui);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.encaisseDepuisJanvierCentimes).toBe((avant.encaisseDepuisJanvierCentimes ?? 0) + 111100);
    });

    it("exclut une rémunération encaissée une année différente (égalité avant/après)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-002");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: `${anneeDifferente}-06-01`,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, `${anneeDifferente}-06-10`);
      const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 222200 });
      idsRemunerationCrees.push(r.id);
      await marquerRemunerationEncaissee(c.id, `${anneeDifferente}-06-15`);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.encaisseDepuisJanvierCentimes).toBe(avant.encaisseDepuisJanvierCentimes);
    });
  });

  describe("previsionnelRestantCentimes — en_cours uniquement, jamais fusionné avec finalisé non encaissé", () => {
    it("inclut une date prévue dans la fenêtre [aujourd'hui, 31/12] (delta sur le montant et le compteur)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-003");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 150000,
        dateEncaissementPrevue: finAnnee,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreRemunerationsPrevisionnellesAvecDatePrevue).toBe(
        avant.nombreRemunerationsPrevisionnellesAvecDatePrevue + 1
      );
      expect(apres.previsionnelRestantCentimes).toBe((avant.previsionnelRestantCentimes ?? 0) + 150000);
    });

    it("une date prévue déjà passée compte dans le compteur mais jamais dans le montant — jamais undefined dès qu'une date est connue (mapping ADR-022)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-004");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 160000,
        dateEncaissementPrevue: hier,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreRemunerationsPrevisionnellesAvecDatePrevue).toBe(
        avant.nombreRemunerationsPrevisionnellesAvecDatePrevue + 1
      );
      expect(typeof apres.previsionnelRestantCentimes).toBe("number");
      expect(apres.previsionnelRestantCentimes).toBe(avant.previsionnelRestantCentimes ?? 0);
    });

    it("une date prévue après le 31/12 compte dans le compteur mais jamais dans le montant (même mapping)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-005");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 170000,
        dateEncaissementPrevue: anneeSuivante,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreRemunerationsPrevisionnellesAvecDatePrevue).toBe(
        avant.nombreRemunerationsPrevisionnellesAvecDatePrevue + 1
      );
      expect(apres.previsionnelRestantCentimes).toBe(avant.previsionnelRestantCentimes ?? 0);
    });

    it("exclut un compromis en_cours sur un bien archivé, du montant et du compteur (égalité avant/après)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-006");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 180000,
        dateEncaissementPrevue: finAnnee,
      });
      idsRemunerationCrees.push(r.id);
      await archiverBien(bien.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreRemunerationsPrevisionnellesAvecDatePrevue).toBe(
        avant.nombreRemunerationsPrevisionnellesAvecDatePrevue
      );
      expect(apres.previsionnelRestantCentimes).toBe(avant.previsionnelRestantCentimes);
    });
  });

  describe("encaissementsAttendusDepassesCentimes — jamais 'retard'", () => {
    it("inclut une vente finalisée non encaissée avec une date prévue dépassée (delta montant et nombre)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-007");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 190000,
        dateEncaissementPrevue: hier,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreEncaissementsAttendusDepasses).toBe(avant.nombreEncaissementsAttendusDepasses + 1);
      expect(apres.nombreFinaliseNonEncaisseAvecDatePrevue).toBe(avant.nombreFinaliseNonEncaisseAvecDatePrevue + 1);
      expect(apres.encaissementsAttendusDepassesCentimes).toBe(
        (avant.encaissementsAttendusDepassesCentimes ?? 0) + 190000
      );
    });

    it("une date prévue demain n'est pas dépassée — comptée dans la couverture mais jamais undefined (mapping ADR-022)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-008");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 200000,
        dateEncaissementPrevue: demain,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreFinaliseNonEncaisseAvecDatePrevue).toBe(avant.nombreFinaliseNonEncaisseAvecDatePrevue + 1);
      expect(apres.nombreEncaissementsAttendusDepasses).toBe(avant.nombreEncaissementsAttendusDepasses);
      expect(typeof apres.encaissementsAttendusDepassesCentimes).toBe("number");
      expect(apres.encaissementsAttendusDepassesCentimes).toBe(avant.encaissementsAttendusDepassesCentimes ?? 0);
    });

    it("une vente finalisée non encaissée sans date prévue compte dans le dénominateur mais pas dans la couverture ni le montant", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-009");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 210000 });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreFinaliseNonEncaisseRenseignees).toBe(avant.nombreFinaliseNonEncaisseRenseignees + 1);
      expect(apres.nombreFinaliseNonEncaisseAvecDatePrevue).toBe(avant.nombreFinaliseNonEncaisseAvecDatePrevue);
      expect(apres.nombreEncaissementsAttendusDepasses).toBe(avant.nombreEncaissementsAttendusDepasses);
      expect(apres.encaissementsAttendusDepassesCentimes).toBe(avant.encaissementsAttendusDepassesCentimes ?? 0);
    });

    it("inclut une vente finalisée non encaissée sur un bien archivé (égalité avant/après archivage, contraste avec le prévisionnel archivé exclu ci-dessus)", async () => {
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-010");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 220000,
        dateEncaissementPrevue: hier,
      });
      idsRemunerationCrees.push(r.id);

      const avantArchivage = await chargerProjectionAnnuelle();
      await archiverBien(bien.id);
      const apresArchivage = await chargerProjectionAnnuelle();

      expect(apresArchivage.encaissementsAttendusDepassesCentimes).toBe(avantArchivage.encaissementsAttendusDepassesCentimes);
      expect(apresArchivage.nombreEncaissementsAttendusDepasses).toBe(avantArchivage.nombreEncaissementsAttendusDepasses);
    });
  });

  describe("finaliseNonEncaisseRestantCentimes — fenêtre symétrique de encaissementsAttendusDepassesCentimes (ADR-024)", () => {
    it("inclut une vente finalisée non encaissée avec une date prévue restant dans l'année (delta montant et nombre)", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-024-001");
      const c = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: hier });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 230000,
        dateEncaissementPrevue: demain,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreFinaliseNonEncaisseRestant).toBe(avant.nombreFinaliseNonEncaisseRestant + 1);
      expect(apres.finaliseNonEncaisseRestantCentimes).toBe((avant.finaliseNonEncaisseRestantCentimes ?? 0) + 230000);
    });

    it("une date prévue déjà dépassée (hier) est comptée dans la couverture mais jamais ajoutée à la fenêtre restante — connu, mais 0 mesuré sur cette fenêtre", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-024-002");
      const c = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: hier });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 240000,
        dateEncaissementPrevue: hier,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      // Comptée dans le dénominateur de couverture (date connue)...
      expect(apres.nombreFinaliseNonEncaisseRestant).toBe(avant.nombreFinaliseNonEncaisseRestant + 1);
      // ...mais jamais ajoutée à la somme de la fenêtre restante — un vrai 0 mesuré sur cette
      // fenêtre, toujours un number défini, jamais undefined tant qu'au moins une date est connue
      // quelque part (mapping ADR-022 appliqué à ADR-024).
      expect(typeof apres.finaliseNonEncaisseRestantCentimes).toBe("number");
      expect(apres.finaliseNonEncaisseRestantCentimes).toBe(avant.finaliseNonEncaisseRestantCentimes ?? 0);
    });

    it("une vente finalisée non encaissée sans date prévue ne compte ni dans le nombre ni dans le montant — inconnu, jamais confondu avec un 0", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-024-003");
      const c = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: hier });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 250000 });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreFinaliseNonEncaisseRestant).toBe(avant.nombreFinaliseNonEncaisseRestant);
      expect(apres.finaliseNonEncaisseRestantCentimes).toBe(avant.finaliseNonEncaisseRestantCentimes ?? 0);
    });

    it("un compromis en_cours (prévisionnel) n'alimente jamais finaliseNonEncaisseRestantCentimes — mutuellement exclusif", async () => {
      const avant = await chargerProjectionAnnuelle();
      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-024-004");
      const c = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: hier });
      idsCompromisCrees.push(c.id);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 260000,
        dateEncaissementPrevue: demain,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();

      expect(apres.nombreFinaliseNonEncaisseRestant).toBe(avant.nombreFinaliseNonEncaisseRestant);
      expect(apres.finaliseNonEncaisseRestantCentimes).toBe(avant.finaliseNonEncaisseRestantCentimes ?? 0);
    });
  });

  describe("ventilationMensuelle — dateEncaissementPrevue pour prévisionnel/finalisé, dateEncaissementReelle pour encaissé", () => {
    it("ventile une rémunération finalisée non encaissée par dateEncaissementPrevue (pas dateEncaissementReelle)", async () => {
      const moisCible = `${anneeCourante}-03`;
      const avant = await chargerProjectionAnnuelle();
      const avantLigne = avant.ventilationMensuelle.find((m) => m.mois === moisCible)!;

      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-011");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({
        compromisId: c.id,
        montantRemunerationConseillerCentimes: 230000,
        dateEncaissementPrevue: `${anneeCourante}-03-15`,
      });
      idsRemunerationCrees.push(r.id);

      const apres = await chargerProjectionAnnuelle();
      const apresLigne = apres.ventilationMensuelle.find((m) => m.mois === moisCible)!;

      expect(apresLigne.finaliseNonEncaisseCentimes).toBe(avantLigne.finaliseNonEncaisseCentimes + 230000);
      expect(apresLigne.encaisseCentimes).toBe(avantLigne.encaisseCentimes);
    });

    it("ventile une rémunération encaissée par dateEncaissementReelle", async () => {
      const moisCible = `${anneeCourante}-04`;
      const avant = await chargerProjectionAnnuelle();
      const avantLigne = avant.ventilationMensuelle.find((m) => m.mois === moisCible)!;

      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-012");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      await marquerCompromisRealise(c.id, hier);
      const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 240000 });
      idsRemunerationCrees.push(r.id);
      await marquerRemunerationEncaissee(c.id, `${anneeCourante}-04-20`);

      const apres = await chargerProjectionAnnuelle();
      const apresLigne = apres.ventilationMensuelle.find((m) => m.mois === moisCible)!;

      expect(apresLigne.encaisseCentimes).toBe(avantLigne.encaisseCentimes + 240000);
    });

    it("une rémunération prévisionnelle sans dateEncaissementPrevue n'apparaît dans aucun mois mais reste dans le total global de chargerRemuneration()", async () => {
      const avantProjection = await chargerProjectionAnnuelle();
      const avantRemuneration = await chargerRemuneration();
      const sommeMensuelleAvant = avantProjection.ventilationMensuelle.reduce(
        (acc, m) => acc + m.previsionnelCentimes,
        0
      );

      const { bien, acquereur } = await creerBienEtAcquereurDeTest("PROJECTION-013");
      const c = await enregistrerCompromis({
        bienId: bien.id,
        acquereurId: acquereur.id,
        prixConvenu: 300000,
        dateSignature: hier,
      });
      idsCompromisCrees.push(c.id);
      const r = await enregistrerRemuneration({ compromisId: c.id, montantRemunerationConseillerCentimes: 250000 });
      idsRemunerationCrees.push(r.id);

      const apresProjection = await chargerProjectionAnnuelle();
      const apresRemuneration = await chargerRemuneration();
      const sommeMensuelleApres = apresProjection.ventilationMensuelle.reduce(
        (acc, m) => acc + m.previsionnelCentimes,
        0
      );

      expect(sommeMensuelleApres).toBe(sommeMensuelleAvant); // absente de toute la ventilation
      expect(apresRemuneration.remunerationPrevisionnelleCentimes).toBe(
        (avantRemuneration.remunerationPrevisionnelleCentimes ?? 0) + 250000
      ); // toujours dans le total global
    });
  });
});
