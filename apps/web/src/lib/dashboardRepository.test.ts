import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

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
} = await import("@/db/schema");
const { creerBien, archiverBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { enregistrerOffre } = await import("./offreRepository");
const { enregistrerCompromis, changerStatutCompromis, marquerCompromisRealise } = await import(
  "./compromisRepository"
);
const { enregistrerCompteRenduVisite } = await import("./compteRenduVisiteRepository");
const { lierVisiteAOffre } = await import("./offreVisiteRepository");
const { chargerResultats, chargerPipeline, chargerActivite, chargerDelaisPertes } = await import(
  "./dashboardRepository"
);

const idsCompromisCrees: string[] = [];
const idsOffresCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
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

describe("dashboardRepository — chargerDelaisPertes", () => {
  it("delaiMoyenOffreCompromisJours exclut un compromis direct sans offreId (égalité avant/après)", async () => {
    const avant = await chargerDelaisPertes();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-001");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-10",
    });
    idsCompromisCrees.push(c.id);

    const apres = await chargerDelaisPertes();

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

    const { delaiMoyenOffreCompromisJours } = await chargerDelaisPertes();

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

    const { delaiMoyenCompromisActeJours } = await chargerDelaisPertes();

    expect(delaiMoyenCompromisActeJours).toBeTypeOf("number");
  });

  it("compte et somme les compromis annulés (delta avant/après)", async () => {
    const avant = await chargerDelaisPertes();
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DELAIS-004");
    const c = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 777000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(c.id);
    await changerStatutCompromis(c.id, "annule");

    const apres = await chargerDelaisPertes();

    expect(apres.compromisAnnules).toBe(avant.compromisAnnules + 1);
    expect(apres.volumeCompromisAnnules).toBe(avant.volumeCompromisAnnules + 777000);
  });

  it("delaiMoyenVisiteOffreJours reste inchangé pour une visite et une offre non liées entre elles (égalité avant/après)", async () => {
    const avant = await chargerDelaisPertes();
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

    const apres = await chargerDelaisPertes();

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

    const { delaiMoyenVisiteOffreJours } = await chargerDelaisPertes();

    expect(delaiMoyenVisiteOffreJours).toBeTypeOf("number");
    expect(delaiMoyenVisiteOffreJours).toBeGreaterThanOrEqual(0);
  });
});
