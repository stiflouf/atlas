import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — candidats set-based des scanners offre_sans_decision et
// offre_acceptee_sans_compromis : requêtes de lecture pure, testées ici indépendamment des scanners
// eux-mêmes (couverts par scanners/offreSansDecision.test.ts et scanners/offreAccepteeSansCompromis.test.ts).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { supprimerEvenementsDeTestPourOffres } = await import("@/db/nettoyageEvenementsDeTest");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  compromis: compromisTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  offres: offresTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { accepterOffre, creerOffre, offresAccepteesSansCompromis, offresEnCoursDepasseesSeuil } = await import("./offreRepository");
const { creerCompromis } = await import("./compromisRepository");

const M = `Zautomation${Date.now()}`;
const idsOffres: string[] = [];
const idsCompromis: string[] = [];
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];
let compteur = 0;

afterAll(async () => {
  // `creerCompromis` émet compromis_signe (cible compromisId, pas offreId) : retiré AVANT le
  // compromis lui-même — même raisonnement que supprimerEvenementsDeTestPourOffres pour offreId,
  // FK NO ACTION oblige (journal append-only, ADR-061 §13).
  if (idsCompromis.length) {
    const evenements = await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.compromisId, idsCompromis));
    const idsEvt = evenements.map((e) => e.id);
    if (idsEvt.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvt));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvt));
    }
  }
  await supprimerEvenementsDeTestPourOffres(idsOffres);
  if (idsCompromis.length) await getDb().delete(compromisTable).where(inArray(compromisTable.id, idsCompromis));
  if (idsOffres.length) await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
  if (idsBiens.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unBien(workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] OFFRE-AUTOMATION-${compteur}-${Date.now()}`,
      titre: "Bien automation",
      type: "appartement",
      adresse: "1 rue de l'Automation",
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
  return bien;
}

async function unAcquereur(workspaceId = WORKSPACE_TEST) {
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
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-offre-auto-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace offre automation" });
  idsWorkspaces.push(id);
  return id;
}

async function uneOffre(bienId: string, acquereurId: string, dateOffre: string, workspaceId = WORKSPACE_TEST) {
  const r = await creerOffre({ bienId, acquereurId, montant: 300000, dateOffre }, [], workspaceId);
  if (r.statut !== "creee") throw new Error(`création attendue, reçu ${r.statut}`);
  idsOffres.push(r.offre.id);
  return r.offre;
}

describe("offresEnCoursDepasseesSeuil", () => {
  it("en_cours + dateOffre <= seuil → candidat ; en_cours mais trop récente → absente", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const vieille = await uneOffre(bien.id, acquereur.id, "2026-06-01");
    const bien2 = await unBien();
    const recente = await uneOffre(bien2.id, await (async () => (await unAcquereur()).id)(), "2026-06-14");

    const candidats = await offresEnCoursDepasseesSeuil(WORKSPACE_TEST, "2026-06-10");
    const ids = candidats.map((c) => c.id);
    expect(ids).toContain(vieille.id);
    expect(ids).not.toContain(recente.id);
  });

  it("refusée → jamais candidate, même ancienne", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await uneOffre(bien.id, acquereur.id, "2026-01-01");
    const { refuserOffre } = await import("./offreRepository");
    await refuserOffre(offre.id, "2026-06-01", "autre", WORKSPACE_TEST);
    const candidats = await offresEnCoursDepasseesSeuil(WORKSPACE_TEST, "2026-06-10");
    expect(candidats.map((c) => c.id)).not.toContain(offre.id);
  });

  it("autre workspace → invisible", async () => {
    const ailleurs = await unAutreWorkspace("sans-decision");
    const bien = await unBien(ailleurs);
    const acquereur = await unAcquereur(ailleurs);
    const offre = await uneOffre(bien.id, acquereur.id, "2026-01-01", ailleurs);
    const candidats = await offresEnCoursDepasseesSeuil(WORKSPACE_TEST, "2026-06-10");
    expect(candidats.map((c) => c.id)).not.toContain(offre.id);
    const candidatsAilleurs = await offresEnCoursDepasseesSeuil(ailleurs, "2026-06-10");
    expect(candidatsAilleurs.map((c) => c.id)).toContain(offre.id);
  });
});

describe("offresAccepteesSansCompromis", () => {
  it("acceptee + dateDecision <= seuil + aucun compromis → candidate", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await uneOffre(bien.id, acquereur.id, "2026-01-01");
    await accepterOffre(offre.id, "2026-06-01", WORKSPACE_TEST);
    const candidats = await offresAccepteesSansCompromis(WORKSPACE_TEST, "2026-06-10");
    expect(candidats.map((c) => c.id)).toContain(offre.id);
  });

  it("un compromis existe déjà pour cette offre → jamais candidate", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await uneOffre(bien.id, acquereur.id, "2026-01-01");
    await accepterOffre(offre.id, "2026-06-01", WORKSPACE_TEST);
    const resultat = await creerCompromis(
      { bienId: bien.id, acquereurId: acquereur.id, offreId: offre.id, prixConvenu: 300000, dateSignature: "2026-06-05" },
      WORKSPACE_TEST
    );
    if (resultat.statut === "cree") idsCompromis.push(resultat.compromis.id);
    const candidats = await offresAccepteesSansCompromis(WORKSPACE_TEST, "2026-06-10");
    expect(candidats.map((c) => c.id)).not.toContain(offre.id);
  });

  it("acceptée trop récemment (dateDecision > seuil) → absente", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const offre = await uneOffre(bien.id, acquereur.id, "2026-01-01");
    await accepterOffre(offre.id, "2026-06-09", WORKSPACE_TEST);
    const candidats = await offresAccepteesSansCompromis(WORKSPACE_TEST, "2026-06-01");
    expect(candidats.map((c) => c.id)).not.toContain(offre.id);
  });

  it("autre workspace → invisible", async () => {
    const ailleurs = await unAutreWorkspace("acceptee-sans-compromis");
    const bien = await unBien(ailleurs);
    const acquereur = await unAcquereur(ailleurs);
    const offre = await uneOffre(bien.id, acquereur.id, "2026-01-01", ailleurs);
    await accepterOffre(offre.id, "2026-06-01", ailleurs);
    const candidats = await offresAccepteesSansCompromis(WORKSPACE_TEST, "2026-06-10");
    expect(candidats.map((c) => c.id)).not.toContain(offre.id);
    const candidatsAilleurs = await offresAccepteesSansCompromis(ailleurs, "2026-06-10");
    expect(candidatsAilleurs.map((c) => c.id)).toContain(offre.id);
  });
});
