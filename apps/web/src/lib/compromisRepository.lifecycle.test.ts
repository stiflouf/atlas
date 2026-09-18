import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-061 §13 — Compromis sous le même ordre de verrous que l'Offre : précondition offre acceptée
// (relue sous verrou), compromis direct sans offre conservé, transitions exact-once avec
// `compromis_realise` / `compromis_annule`, annulation sans effet sur l'offre, lectures scoped.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { supprimerEvenementsDeTestPourOffres } = await import("@/db/nettoyageEvenementsDeTest");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  compromis: compromisTable,
  evenementsMetier: evenementsTable,
  executionsAutomatisation: executionsTable,
  offres: offresTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { accepterOffre, creerOffre, getOffreById } = await import("./offreRepository");
const { creerCompromis, deciderCompromis, getCompromisById, listerCompromisPourBien, modifierDateActeCompromis } = await import("./compromisRepository");
const { statutCommercialBienEffectif } = await import("./statutCommercialBien");
const { listerOffresPourBien } = await import("./offreRepository");

const M = `Zcompromislc${Date.now()}`;
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];
let compteur = 0;

afterAll(async () => {
  if (idsBiens.length) {
    const compromisIds = (await getDb().select({ id: compromisTable.id }).from(compromisTable).where(inArray(compromisTable.bienId, idsBiens))).map((c) => c.id);
    const offreIds = (await getDb().select({ id: offresTable.id }).from(offresTable).where(inArray(offresTable.bienId, idsBiens))).map((o) => o.id);
    if (compromisIds.length) {
      const evts = (await getDb().select({ id: evenementsTable.id }).from(evenementsTable).where(inArray(evenementsTable.compromisId, compromisIds))).map((e) => e.id);
      if (evts.length) {
        await getDb().delete(executionsTable).where(inArray(executionsTable.evenementId, evts));
        await getDb().delete(evenementsTable).where(inArray(evenementsTable.id, evts));
      }
      await getDb().delete(compromisTable).where(inArray(compromisTable.id, compromisIds));
    }
    await supprimerEvenementsDeTestPourOffres(offreIds);
    if (offreIds.length) await getDb().delete(offresTable).where(inArray(offresTable.id, offreIds));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unBien(workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] COMPROMIS-LIFECYCLE-${compteur}-${Date.now()}`,
      titre: "Bien cycle de vie compromis",
      type: "maison",
      adresse: "2 rue du Compromis",
      ville: "Testville",
      codePostal: "00000",
      surface: 90,
      pieces: 4,
      prix: 400000,
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
      budgetMax: 500000,
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
  const id = `ws-compromis-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace compromis" });
  idsWorkspaces.push(id);
  return id;
}

async function offre(bienId: string, acquereurId: string) {
  const r = await creerOffre({ bienId, acquereurId, montant: 380000, dateOffre: "2026-08-01" }, [], WORKSPACE_TEST);
  if (r.statut !== "creee") throw new Error(r.statut);
  return r.offre;
}

async function evenementsCompromis(compromisId: string, type: string) {
  return getDb().select().from(evenementsTable).where(and(eq(evenementsTable.compromisId, compromisId), eq(evenementsTable.typeEvenement, type)));
}

describe("creerCompromis (ADR-061 §13)", () => {
  it("J. offre en_cours → offre_non_acceptee ; offre acceptée → cree + compromis_signe ; direct sans offre → cree", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const o = await offre(bien.id, acquereur.id);
    expect(await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, offreId: o.id, prixConvenu: 380000, dateSignature: "2026-08-20" }, WORKSPACE_TEST)).toEqual({
      statut: "offre_non_acceptee",
      statutOffre: "en_cours",
    });
    await accepterOffre(o.id, "2026-08-10", WORKSPACE_TEST);
    const cree = await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, offreId: o.id, prixConvenu: 380000, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    expect(cree.statut).toBe("cree");
    if (cree.statut !== "cree") return;
    expect(await evenementsCompromis(cree.compromis.id, "compromis_signe")).toHaveLength(1);
    expect(await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, offreId: o.id, prixConvenu: 1, dateSignature: "2026-08-21" }, WORKSPACE_TEST)).toEqual({ statut: "compromis_en_cours_existant" });

    const bien2 = await unBien();
    const direct = await creerCompromis({ bienId: bien2.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    expect(direct.statut).toBe("cree");
  });

  it("offre d'un autre bien / autre acquéreur / déjà utilisée → refus typés", async () => {
    const bien = await unBien();
    const bien2 = await unBien();
    const [a, b] = await Promise.all([unAcquereur(), unAcquereur()]);
    const o = await offre(bien.id, a.id);
    await accepterOffre(o.id, "2026-08-10", WORKSPACE_TEST);
    expect(await creerCompromis({ bienId: bien2.id, acquereurId: a.id, offreId: o.id, prixConvenu: 1, dateSignature: "2026-08-20" }, WORKSPACE_TEST)).toEqual({ statut: "offre_autre_bien" });
    expect(await creerCompromis({ bienId: bien.id, acquereurId: b.id, offreId: o.id, prixConvenu: 1, dateSignature: "2026-08-20" }, WORKSPACE_TEST)).toEqual({ statut: "offre_incoherente" });
    const cree = await creerCompromis({ bienId: bien.id, acquereurId: a.id, offreId: o.id, prixConvenu: 1, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    if (cree.statut !== "cree") throw new Error(cree.statut);
    await deciderCompromis(cree.compromis.id, { statut: "annule", dateAnnulation: "2026-09-01", motifAnnulation: "autre" }, WORKSPACE_TEST);
    expect(await creerCompromis({ bienId: bien.id, acquereurId: a.id, offreId: o.id, prixConvenu: 1, dateSignature: "2026-09-02" }, WORKSPACE_TEST)).toEqual({ statut: "offre_deja_utilisee" });
  });
});

describe("transitions compromis et effet sur l'offre", () => {
  it("K. realise → compromis_realise exact once ; second geste → deja_finalise", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const cree = await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    if (cree.statut !== "cree") throw new Error(cree.statut);
    const [r1, r2] = await Promise.all([
      deciderCompromis(cree.compromis.id, { statut: "realise", dateActeReelle: "2026-11-01" }, WORKSPACE_TEST),
      deciderCompromis(cree.compromis.id, { statut: "realise", dateActeReelle: "2026-11-01" }, WORKSPACE_TEST),
    ]);
    expect([r1.statut, r2.statut].sort()).toEqual(["decide", "deja_finalise"]);
    expect(await evenementsCompromis(cree.compromis.id, "compromis_realise")).toHaveLength(1);
    expect(await deciderCompromis(cree.compromis.id, { statut: "annule", dateAnnulation: "2026-11-02", motifAnnulation: "autre" }, WORKSPACE_TEST)).toEqual({ statut: "deja_finalise", statutActuel: "realise" });
    expect(statutCommercialBienEffectif(bien, [], await listerCompromisPourBien(bien.id, WORKSPACE_TEST))).toBe("vendu");
  });

  it("annuler un compromis : compromis_annule exact once, l'offre reste acceptee (ni en_cours, ni caduque), statut commercial offre_acceptee", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const o = await offre(bien.id, acquereur.id);
    await accepterOffre(o.id, "2026-08-10", WORKSPACE_TEST);
    const cree = await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, offreId: o.id, prixConvenu: 380000, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    if (cree.statut !== "cree") throw new Error(cree.statut);
    const annulation = await deciderCompromis(cree.compromis.id, { statut: "annule", dateAnnulation: "2026-09-01", motifAnnulation: "financement_refuse" }, WORKSPACE_TEST);
    expect(annulation.statut).toBe("decide");
    expect(await evenementsCompromis(cree.compromis.id, "compromis_annule")).toHaveLength(1);
    const offreApres = (await getOffreById(o.id, WORKSPACE_TEST))!;
    expect(offreApres.statut).toBe("acceptee");
    expect(offreApres.dateDecision).toBe("2026-08-10");
    const offres = await listerOffresPourBien(bien.id, WORKSPACE_TEST);
    const compromis = await listerCompromisPourBien(bien.id, WORKSPACE_TEST);
    expect(statutCommercialBienEffectif(bien, offres, compromis)).toBe("offre_acceptee");
  });

  it("modifierDateActeCompromis : en_cours seulement, scoped", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const cree = await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    if (cree.statut !== "cree") throw new Error(cree.statut);
    const autre = await unAutreWorkspace("dateacte");
    expect(await modifierDateActeCompromis(cree.compromis.id, "2026-12-01", autre)).toEqual({ statut: "introuvable" });
    const modifie = await modifierDateActeCompromis(cree.compromis.id, "2026-12-01", WORKSPACE_TEST);
    expect(modifie.statut === "modifie" && modifie.compromis.dateActe).toBe("2026-12-01");
    await deciderCompromis(cree.compromis.id, { statut: "realise", dateActeReelle: "2026-12-01" }, WORKSPACE_TEST);
    expect(await modifierDateActeCompromis(cree.compromis.id, "2027-01-01", WORKSPACE_TEST)).toEqual({ statut: "deja_finalise", statutActuel: "realise" });
  });

  it("H/I. autre workspace : lectures vides, création et transitions introuvables", async () => {
    const bien = await unBien();
    const acquereur = await unAcquereur();
    const cree = await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-20" }, WORKSPACE_TEST);
    if (cree.statut !== "cree") throw new Error(cree.statut);
    const autre = await unAutreWorkspace("scope");
    expect(await getCompromisById(cree.compromis.id, autre)).toBeUndefined();
    expect(await listerCompromisPourBien(bien.id, autre)).toEqual([]);
    expect(await creerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 1, dateSignature: "2026-08-21" }, autre)).toEqual({ statut: "bien_introuvable" });
    expect(await deciderCompromis(cree.compromis.id, { statut: "realise", dateActeReelle: "2026-11-01" }, autre)).toEqual({ statut: "introuvable" });
    expect((await getCompromisById(cree.compromis.id, WORKSPACE_TEST))!.statut).toBe("en_cours");
  });
});
