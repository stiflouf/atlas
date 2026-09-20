import { afterAll, describe, expect, it } from "vitest";
import { inArray, or } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// Test d'intégration : les FK comptes_rendus_visite -> biens/acquereurs imposent des ids réels,
// donc un mock ne suffit pas ici. VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — couvre désormais aussi le
// writer central `creerCompteRenduEtRealiserVisite` (verrou Visite, transaction unique CR + statut
// realisee + événement), sa garantie de cardinalité 0..1 (UNIQUE partiel `visite_id`), et les
// courses réelles double-CR / réalisation-vs-annulation.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  workspaces: workspacesTable,
  visites: visitesTable,
  comptesRendusVisite: comptesRendusVisiteTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { creerVisite, getVisiteById } = await import("./visiteRepository");
const {
  listerComptesRendusPourBien,
  getCompteRenduVisiteById,
  getCompteRenduVisiteParVisiteId,
  enregistrerCompteRenduVisite,
  creerCompteRenduEtRealiserVisite,
} = await import("./compteRenduVisiteRepository");

const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  // evenements_metier référence visites/comptes_rendus_visite en NO ACTION (append-only, ADR-032/
  // migration 0050) — doit être purgé AVANT la suppression cascade des biens, sinon la FK bloque le
  // DELETE (même patron que catalogueRegles.nouveauMatch.test.ts).
  if (idsBiensCrees.length) {
    const visites = await getDb().select({ id: visitesTable.id }).from(visitesTable).where(inArray(visitesTable.bienId, idsBiensCrees));
    const comptesRendus = await getDb()
      .select({ id: comptesRendusVisiteTable.id })
      .from(comptesRendusVisiteTable)
      .where(inArray(comptesRendusVisiteTable.bienId, idsBiensCrees));
    const idsVisites = visites.map((v) => v.id);
    const idsComptesRendus = comptesRendus.map((c) => c.id);
    if (idsVisites.length || idsComptesRendus.length) {
      const filtre = or(
        idsVisites.length ? inArray(evenementsMetier.visiteId, idsVisites) : undefined,
        idsComptesRendus.length ? inArray(evenementsMetier.compteRenduVisiteId, idsComptesRendus) : undefined
      );
      const evenements = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(filtre);
      const idsEvenements = evenements.map((e) => e.id);
      if (idsEvenements.length) {
        await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvenements));
        await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvenements));
      }
    }
  }
  // comptes_rendus_visite/visites référencées CASCADE depuis biens/acquereurs.
  if (idsBiensCrees.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiensCrees));
  if (idsAcquereursCrees.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereursCrees));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

let compteur = 0;

async function creerJeuDeTest(suffixe: string, workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien({
    reference: `[test réel] CR-VISITE-${suffixe}-${compteur}-${Date.now()}`,
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
  }, workspaceId);
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] CR Visite ${suffixe}-${compteur}`,
    email: `test-réel-cr-${suffixe}-${compteur}-${Date.now()}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  }, workspaceId);
  idsAcquereursCrees.push(acquereur.id);
  return { bien, acquereur };
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-cr-visite-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace CR visite" });
  idsWorkspaces.push(id);
  return id;
}

describe("compteRenduVisiteRepository — lectures (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien mocké), sans erreur de cast", async () => {
    await expect(listerComptesRendusPourBien("bien-001", WORKSPACE_TEST)).resolves.toEqual([]);
  });

  it("enregistrerCompteRenduVisite() persiste, listerComptesRendusPourBien() les retrouve triés DESC", async () => {
    const { bien, acquereur } = await creerJeuDeTest("LECTURE1");

    const ancien = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Ancien compte rendu.",
      interet: "a_reflechir",
    });
    const recent = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-10",
      retour: "Compte rendu plus récent.",
      interet: "interesse",
      prochaineEtape: "Envoyer une contre-proposition.",
    });

    const comptesRendus = await listerComptesRendusPourBien(bien.id, WORKSPACE_TEST);
    const pertinents = comptesRendus.filter((cr) => cr.id === ancien.id || cr.id === recent.id);

    expect(pertinents.map((cr) => cr.id)).toEqual([recent.id, ancien.id]);
    expect(pertinents[0].prochaineEtape).toBe("Envoyer une contre-proposition.");
    expect(pertinents[1].prochaineEtape).toBeUndefined();
  });

  it("isolation workspace : lectures vides/undefined depuis un autre workspace", async () => {
    const { bien, acquereur } = await creerJeuDeTest("LECTURE-WS1");
    const compteRendu = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "R.",
      interet: "inconnu",
    });
    const autre = await unAutreWorkspace("lecture");

    expect(await listerComptesRendusPourBien(bien.id, autre)).toEqual([]);
    expect(await getCompteRenduVisiteById(compteRendu.id, autre)).toBeUndefined();
    expect(await listerComptesRendusPourBien(bien.id, WORKSPACE_TEST)).toContainEqual(
      expect.objectContaining({ id: compteRendu.id })
    );
  });
});

describe("creerCompteRenduEtRealiserVisite — writer central (VISIT_NATIVE_LIFECYCLE_V1, §16)", () => {
  it("visiteId absent : compte rendu enregistré sans lien, aucune transition", async () => {
    const { bien, acquereur } = await creerJeuDeTest("HORSCYCLE1");
    const resultat = await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, dateVisite: "2026-08-01", retour: "Hors cycle.", interet: "inconnu" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("cree");
    if (resultat.statut !== "cree") return;
    expect(resultat.compteRendu.visiteId).toBeUndefined();
    expect(resultat.visite).toBeUndefined();
  });

  it("visiteId valide, visite planifiee : CR lié, visite → realisee, realiseeLe posé", async () => {
    const { bien, acquereur } = await creerJeuDeTest("REALISE1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const resultat = await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "Bon retour.", interet: "interesse" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("cree");
    if (resultat.statut !== "cree") return;
    expect(resultat.compteRendu.visiteId).toBe(cree.visite.id);
    expect(resultat.visite?.statut).toBe("realisee");
    expect(resultat.visite?.realiseeLe).toBeDefined();
    expect(Array.isArray(resultat.idsExecutionsATraiter)).toBe(true);
    expect((await getVisiteById(cree.visite.id, WORKSPACE_TEST))?.statut).toBe("realisee");
    expect((await getCompteRenduVisiteParVisiteId(cree.visite.id, WORKSPACE_TEST))?.id).toBe(resultat.compteRendu.id);
  });

  it("visiteId d'un autre bien/acquéreur (incohérence défensive) : CR enregistré sans lien, visite non touchée", async () => {
    const { bien, acquereur } = await creerJeuDeTest("MISMATCH1");
    const { bien: autreBien } = await creerJeuDeTest("MISMATCH1-AUTRE");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const resultat = await creerCompteRenduEtRealiserVisite(
      { bienId: autreBien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "R.", interet: "inconnu" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("cree");
    if (resultat.statut !== "cree") return;
    expect(resultat.compteRendu.visiteId).toBeUndefined();
    expect(resultat.visite).toBeUndefined();
    expect((await getVisiteById(cree.visite.id, WORKSPACE_TEST))?.statut).toBe("planifiee");
  });

  it("visite déjà realisee au moment du verrou : visite_deja_finalisee, aucun second CR créé", async () => {
    const { bien, acquereur } = await creerJeuDeTest("DOUBLECR1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    const premier = await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "Premier.", interet: "interesse" },
      WORKSPACE_TEST
    );
    if (premier.statut !== "cree") throw new Error("réalisation attendue");

    const second = await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-02", retour: "Second — perdant.", interet: "pas_interesse" },
      WORKSPACE_TEST
    );
    expect(second.statut).toBe("visite_deja_finalisee");

    const comptesRendus = await listerComptesRendusPourBien(bien.id, WORKSPACE_TEST);
    expect(comptesRendus.filter((cr) => cr.visiteId === cree.visite.id)).toHaveLength(1);
  });

  it("deux créations de CR réellement concurrentes sur la même visite planifiee : une seule gagne (UNIQUE partiel visite_id + verrou), l'autre visite_deja_finalisee", async () => {
    const { bien, acquereur } = await creerJeuDeTest("DOUBLECRCONC1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const [a, b] = await Promise.all([
      creerCompteRenduEtRealiserVisite(
        { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "A.", interet: "interesse" },
        WORKSPACE_TEST
      ),
      creerCompteRenduEtRealiserVisite(
        { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "B.", interet: "a_reflechir" },
        WORKSPACE_TEST
      ),
    ]);
    const statuts = [a.statut, b.statut].sort();
    expect(statuts).toEqual(["cree", "visite_deja_finalisee"]);

    const comptesRendus = await listerComptesRendusPourBien(bien.id, WORKSPACE_TEST);
    expect(comptesRendus.filter((cr) => cr.visiteId === cree.visite.id)).toHaveLength(1);
    expect((await getVisiteById(cree.visite.id, WORKSPACE_TEST))?.statut).toBe("realisee");
  });

  it("réalisation vs annulation réellement concurrentes sur la même visite : exactement une des deux transitions l'emporte", async () => {
    const { annulerVisite } = await import("./visiteRepository");
    const { bien, acquereur } = await creerJeuDeTest("REALVSANNUL1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    const [realisation, annulation] = await Promise.all([
      creerCompteRenduEtRealiserVisite(
        { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "R.", interet: "interesse" },
        WORKSPACE_TEST
      ),
      annulerVisite(cree.visite.id, WORKSPACE_TEST),
    ]);

    const visiteFinale = await getVisiteById(cree.visite.id, WORKSPACE_TEST);
    if (realisation.statut === "cree") {
      // La réalisation a gagné la course : l'annulation concurrente doit avoir échoué proprement.
      expect(annulation.statut).toBe("deja_finalisee");
      expect(visiteFinale?.statut).toBe("realisee");
    } else {
      // L'annulation a gagné : la réalisation concurrente doit avoir échoué proprement, sans CR
      // orphelin créé pour cette visite.
      expect(realisation.statut).toBe("visite_deja_finalisee");
      expect(annulation.statut).toBe("annulee");
      expect(visiteFinale?.statut).toBe("annulee");
      const comptesRendus = await listerComptesRendusPourBien(bien.id, WORKSPACE_TEST);
      expect(comptesRendus.filter((cr) => cr.visiteId === cree.visite.id)).toHaveLength(0);
    }
  });

  it("visite déjà annulee au moment du verrou : visite_deja_finalisee", async () => {
    const { annulerVisite } = await import("./visiteRepository");
    const { bien, acquereur } = await creerJeuDeTest("ANNULEEPREALABLE1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");
    await annulerVisite(cree.visite.id, WORKSPACE_TEST);

    const resultat = await creerCompteRenduEtRealiserVisite(
      { bienId: bien.id, acquereurId: acquereur.id, visiteId: cree.visite.id, dateVisite: "2026-09-01", retour: "R.", interet: "inconnu" },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("visite_deja_finalisee");
  });
});

describe("UNIQUE partiel comptes_rendus_visite.visite_id (garantie DB, migration 0050)", () => {
  it("un INSERT direct en second sur le même visite_id est rejeté par Postgres", async () => {
    const { bien, acquereur } = await creerJeuDeTest("UNIQUEDB1");
    const cree = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-09-01" }, WORKSPACE_TEST);
    if (cree.statut !== "creee") throw new Error("création attendue");

    await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      visiteId: cree.visite.id,
      dateVisite: "2026-09-01",
      retour: "Premier.",
      interet: "inconnu",
    });

    await expect(
      enregistrerCompteRenduVisite({
        bienId: bien.id,
        acquereurId: acquereur.id,
        visiteId: cree.visite.id,
        dateVisite: "2026-09-01",
        retour: "Second — direct, contourne le writer.",
        interet: "inconnu",
      })
    ).rejects.toThrow();
  });

  it("plusieurs comptes rendus SANS lien (visite_id NULL) : jamais contraints entre eux", async () => {
    const { bien, acquereur } = await creerJeuDeTest("UNIQUEDB2");
    await enregistrerCompteRenduVisite({ bienId: bien.id, acquereurId: acquereur.id, dateVisite: "2026-08-01", retour: "A.", interet: "inconnu" });
    await enregistrerCompteRenduVisite({ bienId: bien.id, acquereurId: acquereur.id, dateVisite: "2026-08-02", retour: "B.", interet: "inconnu" });
    const comptesRendus = await listerComptesRendusPourBien(bien.id, WORKSPACE_TEST);
    expect(comptesRendus.filter((cr) => cr.visiteId === undefined)).toHaveLength(2);
  });
});
