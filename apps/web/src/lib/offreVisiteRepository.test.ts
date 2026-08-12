import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : offre_visites (ADR-019) impose des FK réelles sur offres et
// comptes_rendus_visite. Même principe que offreRepository.test.ts : bien/acquéreur/offre/compte
// rendu dédiés à ce fichier.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  comptesRendusVisite: comptesRendusVisiteTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { enregistrerOffre, getOffreById } = await import("./offreRepository");
const { enregistrerCompteRenduVisite, getCompteRenduVisiteById } = await import("./compteRenduVisiteRepository");
const {
  listerLiensPourBien,
  lierVisiteAOffre,
  retirerLienVisiteOffre,
  getLienOffreVisiteById,
  getLienOffreVisite,
} = await import("./offreVisiteRepository");

const idsOffresCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsOffresCrees) {
    await getDb().delete(offresTable).where(eq(offresTable.id, id));
  }
  for (const id of idsComptesRendusCrees) {
    await getDb().delete(comptesRendusVisiteTable).where(eq(comptesRendusVisiteTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerJeuDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] OFFRE-VISITE-${suffixe}`,
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
    nom: `[test réel] Offre Visite ${suffixe}`,
    email: `test-réel-offre-visite-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "offre",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const offre = await enregistrerOffre({
    bienId: bien.id,
    acquereurId: acquereur.id,
    montant: 300000,
    dateOffre: "2026-08-10",
  });
  idsOffresCrees.push(offre.id);
  const compteRendu = await enregistrerCompteRenduVisite({
    bienId: bien.id,
    acquereurId: acquereur.id,
    dateVisite: "2026-08-01",
    retour: "Retour de test.",
    interet: "interesse",
  });
  idsComptesRendusCrees.push(compteRendu.id);
  return { bien, acquereur, offre, compteRendu };
}

describe("offreVisiteRepository (intégration Postgres)", () => {
  it("lierVisiteAOffre() persiste le lien, listerLiensPourBien() le retrouve", async () => {
    const { bien, offre, compteRendu } = await creerJeuDeTest("001");

    const lien = await lierVisiteAOffre(offre.id, compteRendu.id);
    expect(lien.offreId).toBe(offre.id);
    expect(lien.compteRenduVisiteId).toBe(compteRendu.id);

    const liens = await listerLiensPourBien(bien.id);
    expect(liens).toEqual([{ lienId: lien.id, offreId: offre.id, visite: compteRendu }]);
  });

  it("getLienOffreVisite() détecte une paire déjà liée, getLienOffreVisiteById() la retrouve par son id", async () => {
    const { offre, compteRendu } = await creerJeuDeTest("002");

    expect(await getLienOffreVisite(offre.id, compteRendu.id)).toBeUndefined();
    const lien = await lierVisiteAOffre(offre.id, compteRendu.id);

    await expect(getLienOffreVisite(offre.id, compteRendu.id)).resolves.toEqual(lien);
    await expect(getLienOffreVisiteById(lien.id)).resolves.toEqual(lien);
  });

  it("rejette une paire (offreId, compteRenduVisiteId) dupliquée (contrainte unique, dernier filet de sécurité)", async () => {
    const { offre, compteRendu } = await creerJeuDeTest("003");
    await lierVisiteAOffre(offre.id, compteRendu.id);

    await expect(lierVisiteAOffre(offre.id, compteRendu.id)).rejects.toThrow();
  });

  it("retirerLienVisiteOffre() supprime uniquement le lien, jamais l'offre ni le compte rendu", async () => {
    const { bien, offre, compteRendu } = await creerJeuDeTest("004");
    const lien = await lierVisiteAOffre(offre.id, compteRendu.id);

    await retirerLienVisiteOffre(lien.id);

    await expect(listerLiensPourBien(bien.id)).resolves.toEqual([]);
    await expect(getOffreById(offre.id)).resolves.toBeDefined();
    await expect(getCompteRenduVisiteById(compteRendu.id)).resolves.toBeDefined();
  });

  it("supprimer l'offre supprime le lien en cascade (le compte rendu, lui, survit)", async () => {
    const { bien, offre, compteRendu } = await creerJeuDeTest("005");
    await lierVisiteAOffre(offre.id, compteRendu.id);

    await getDb().delete(offresTable).where(eq(offresTable.id, offre.id));
    idsOffresCrees.splice(idsOffresCrees.indexOf(offre.id), 1);

    await expect(listerLiensPourBien(bien.id)).resolves.toEqual([]);
    await expect(getCompteRenduVisiteById(compteRendu.id)).resolves.toBeDefined();
  });
});
