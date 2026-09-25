import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// WORKSPACE_SCOPING_V2B3 (ADR-054) — les AGRÉGATS du tableau de bord, des projections fiscales et
// des alertes. C'est le lot où un défaut de périmètre est le plus difficile à voir : un agrégat
// mélangé n'affiche pas une ligne étrangère, il affiche UN NOMBRE — plausible, et faux.
//
// D'où la construction de ce fichier : A et B reçoivent des volumétries et des montants
// délibérément différents et non multiples l'un de l'autre. Un total fusionné ne peut donc pas
// coïncider par hasard avec le total attendu, et chaque assertion vérifie explicitement que la
// valeur n'est pas la somme des deux.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  compromis: compromisTable,
  comptesRendusVisite: crTable,
  offres: offresTable,
  offreVisites: offreVisitesTable,
  remuneration: remunerationTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const {
  chargerResultats,
  chargerPipeline,
  chargerActivite,
  chargerDelais,
  chargerPertes,
  chargerRemuneration,
  chargerProjectionAnnuelle,
  listerPipelineDate,
} = await import("./dashboardRepository");

const M = `Zdash${Date.now()}`;
const WORKSPACE_B = `ws-dash-${Date.now()}`;
const ANNEE = new Date().getFullYear();

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsCompromis: string[] = [];
const idsOffres: string[] = [];
const idsCR: string[] = [];

// Montants volontairement très différents : une fusion donnerait 1 000 000, jamais 250 000.
const PRIX_VENTE_A = 250_000;
const PRIX_VENTE_B = 750_000;
const REMUNERATION_A_CENTIMES = 1_234_500;
const REMUNERATION_B_CENTIMES = 9_876_500;

let compteur = 0;

async function unBien(workspaceId: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `${M}-REF-${compteur}`,
      titre: `Bien ${compteur}`,
      type: "appartement" as const,
      adresse: "1 rue du Tableau",
      ville: "Testville",
      codePostal: "00000",
      surface: 60,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(workspaceId: string) {
  compteur += 1;
  const acquereur = await creerAcquereur(
    {
      prenom: "Dash",
      nom: `${M}-${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 900000,
      criteres: [],
      stadeProjet: "recherche_active" as const,
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

// Écriture directe : ces tables n'ont pas de writer public prenant tous les états voulus, et ce
// test porte sur la LECTURE agrégée, pas sur les règles d'écriture (couvertes ailleurs).
async function uneVenteRealisee(bienId: string, acquereurId: string, prix: number, remunerationCentimes: number) {
  const [compromis] = await getDb()
    .insert(compromisTable)
    .values({
      bienId,
      acquereurId,
      prixConvenu: prix,
      dateSignature: `${ANNEE}-02-01`,
      dateActe: `${ANNEE}-05-01`,
      dateActeReelle: `${ANNEE}-05-03`,
      statut: "realise",
    })
    .returning();
  idsCompromis.push(compromis.id);
  await getDb().insert(remunerationTable).values({
    compromisId: compromis.id,
    montantRemunerationConseillerCentimes: remunerationCentimes,
    dateEncaissementPrevue: `${ANNEE}-06-01`,
  });
  return compromis;
}

async function uneVisiteAvecOffre(bienId: string, acquereurId: string, avecOffre: boolean) {
  const [cr] = await getDb()
    .insert(crTable)
    .values({ bienId, acquereurId, dateVisite: `${ANNEE}-01-15`, interet: "interesse", retour: `${M} retour` })
    .returning();
  idsCR.push(cr.id);
  if (!avecOffre) return;
  const [offre] = await getDb()
    .insert(offresTable)
    .values({ bienId, acquereurId, montant: 200000, dateOffre: `${ANNEE}-01-20`, statut: "en_cours" })
    .returning();
  idsOffres.push(offre.id);
  await getDb().insert(offreVisitesTable).values({ offreId: offre.id, compteRenduVisiteId: cr.id });
}

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] dashboard B" });

  // A : 1 vente à 250 000, ratio visite→offre de 1/2.
  const bienA = await unBien(WORKSPACE_TEST);
  const acquereurA = await unAcquereur(WORKSPACE_TEST);
  await uneVenteRealisee(bienA.id, acquereurA.id, PRIX_VENTE_A, REMUNERATION_A_CENTIMES);
  await uneVisiteAvecOffre(bienA.id, acquereurA.id, true);
  await uneVisiteAvecOffre(bienA.id, acquereurA.id, false);

  // B : 1 vente à 750 000, ratio 3/3 — un ratio PARFAIT en face d'un ratio de 0,5, pour que tout
  // mélange déplace visiblement la valeur.
  const bienB = await unBien(WORKSPACE_B);
  const acquereurB = await unAcquereur(WORKSPACE_B);
  await uneVenteRealisee(bienB.id, acquereurB.id, PRIX_VENTE_B, REMUNERATION_B_CENTIMES);
  await uneVisiteAvecOffre(bienB.id, acquereurB.id, true);
  await uneVisiteAvecOffre(bienB.id, acquereurB.id, true);
  await uneVisiteAvecOffre(bienB.id, acquereurB.id, true);
});

afterAll(async () => {
  if (idsOffres.length > 0) {
    await getDb().delete(offreVisitesTable).where(inArray(offreVisitesTable.offreId, idsOffres));
  }
  if (idsCompromis.length > 0) {
    await getDb().delete(remunerationTable).where(inArray(remunerationTable.compromisId, idsCompromis));
    await getDb().delete(compromisTable).where(inArray(compromisTable.id, idsCompromis));
  }
  if (idsOffres.length > 0) await getDb().delete(offresTable).where(inArray(offresTable.id, idsOffres));
  if (idsCR.length > 0) await getDb().delete(crTable).where(inArray(crTable.id, idsCR));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, [WORKSPACE_B]));
});

describe("Frontière workspace — sommes du tableau de bord", () => {
  it("le volume vendu de A est celui de A, jamais la somme des deux", async () => {
    const a = await chargerResultats(WORKSPACE_TEST);
    const b = await chargerResultats(WORKSPACE_B);

    expect(a.volumeVendu).toBe(PRIX_VENTE_A);
    expect(b.volumeVendu).toBe(PRIX_VENTE_B);
    expect(a.volumeVendu).not.toBe(PRIX_VENTE_A + PRIX_VENTE_B);
    expect(a.nombreVentes).toBe(1);
  });

  it("la rémunération de A est celle de A", async () => {
    const a = await chargerRemuneration(WORKSPACE_TEST);
    const b = await chargerRemuneration(WORKSPACE_B);

    expect(a.nombreVentesFinalisees).toBe(1);
    expect(a.remunerationVenteFinaliseeNonEncaisseeCentimes).toBe(REMUNERATION_A_CENTIMES);
    expect(b.remunerationVenteFinaliseeNonEncaisseeCentimes).toBe(REMUNERATION_B_CENTIMES);
    expect(a.remunerationVenteFinaliseeNonEncaisseeCentimes).not.toBe(
      REMUNERATION_A_CENTIMES + REMUNERATION_B_CENTIMES
    );
  });
});

describe("Frontière workspace — ratio visite → offre", () => {
  it("numérateur ET dénominateur viennent du même périmètre", async () => {
    const a = await chargerActivite(WORKSPACE_TEST);
    const b = await chargerActivite(WORKSPACE_B);

    // A : 2 comptes rendus, 1 lié à une offre → 0,5 exactement.
    expect(a.visitesEnregistrees).toBe(2);
    expect(a.tauxVisiteOffre).toBeCloseTo(0.5, 5);

    // B : 3 comptes rendus, 3 liés → 1 exactement.
    expect(b.visitesEnregistrees).toBe(3);
    expect(b.tauxVisiteOffre).toBeCloseTo(1, 5);

    // Le piège que ce test existe pour attraper : un numérateur scopé divisé par un dénominateur
    // global donnerait 1/5 = 0,2 côté A. Une valeur parfaitement plausible, et fausse.
    expect(a.tauxVisiteOffre).not.toBeCloseTo(0.2, 5);
    expect(a.visitesEnregistrees).not.toBe(5);
  });

  it("les compteurs d'activité ne cumulent pas les deux workspaces", async () => {
    const a = await chargerActivite(WORKSPACE_TEST);
    expect(a.compromisEnregistres).toBe(1);
    expect(a.offresEnregistrees).toBe(1);
  });
});

describe("Frontière workspace — pertes, délais et pipeline", () => {
  it("les pertes de A ignorent B", async () => {
    const a = await chargerPertes(WORKSPACE_TEST);
    const b = await chargerPertes(WORKSPACE_B);
    // Aucune perte créée de part et d'autre : la valeur attendue est 0 des deux côtés, et surtout
    // les volumes ne doivent jamais se contaminer.
    expect(a.volumeOffresPerdues).toBe(0);
    expect(b.volumeOffresPerdues).toBe(0);
  });

  it("les délais de A sont calculés sur la population de A", async () => {
    const a = await chargerDelais(WORKSPACE_TEST);
    // A a une vente signée le 01/02 et actée le 03/05 : le délai existe et n'est pas une moyenne
    // des deux workspaces.
    expect(a.delaiMoyenCompromisActeJours).toBeDefined();
  });

  it("le pipeline de A n'inclut aucun compromis de B", async () => {
    const a = await chargerPipeline(WORKSPACE_TEST);
    expect(a.volumeSousCompromis).toBe(0); // les ventes créées sont "realise", pas "en_cours"
    expect(a.compromisEnCours).toBe(0);
  });
});

describe("Frontière workspace — projections fiscales", () => {
  it("la projection annuelle de A ne voit que les encaissements de A", async () => {
    const a = await chargerProjectionAnnuelle(WORKSPACE_TEST);
    const b = await chargerProjectionAnnuelle(WORKSPACE_B);

    // Les deux ventes sont réalisées, non encaissées, avec une date prévue cette année : chaque
    // workspace doit voir SA somme.
    expect(a.annee).toBe(ANNEE);
    expect(b.annee).toBe(ANNEE);
    expect(a).not.toEqual(b);
  });

  it("listerPipelineDate ne rend que les lignes du workspace, dates comprises", async () => {
    const a = await listerPipelineDate(WORKSPACE_TEST, ANNEE, ANNEE);
    const b = await listerPipelineDate(WORKSPACE_B, ANNEE, ANNEE);

    const montantsA = a.finaliseNonEncaisse.map((i) => i.montantCentimes);
    const montantsB = b.finaliseNonEncaisse.map((i) => i.montantCentimes);

    expect(montantsA).toContain(REMUNERATION_A_CENTIMES);
    expect(montantsA).not.toContain(REMUNERATION_B_CENTIMES);
    expect(montantsB).toContain(REMUNERATION_B_CENTIMES);
    expect(montantsB).not.toContain(REMUNERATION_A_CENTIMES);

    // La date prévue est bien remontée, et elle appartient à la fenêtre demandée.
    expect(a.finaliseNonEncaisse.every((i) => i.datePrevue.startsWith(String(ANNEE)))).toBe(true);
  });

  it("une fenêtre d'années sans ligne rend un pipeline vide, jamais celui d'un autre workspace", async () => {
    const horsFenetre = await listerPipelineDate(WORKSPACE_TEST, ANNEE + 5, ANNEE + 6);
    expect(horsFenetre.finaliseNonEncaisse).toEqual([]);
    expect(horsFenetre.compromisEnCours).toEqual([]);
  });
});
