import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : les vérifications de cohérence lisent des entités réelles (compromis,
// prospect vendeur) — même repli DATABASE_URL que les autres suites d'intégration.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  prospectsVendeurs: prospectsVendeursTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { creerProspectVendeur, signerMandatProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { validerCoherenceRattachementsDocument } = await import("./coherenceRattachementDocument");

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsCompromis: string[] = [];
const idsProspects: string[] = [];

afterAll(async () => {
  for (const id of idsCompromis) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsProspects) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienTest(reference: string) {
  const bien = await creerBien({
    reference,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue Test",
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
  idsBiens.push(bien.id);
  return bien;
}

async function creerAcquereurTest(email: string) {
  const acquereur = await creerAcquereur({
    prenom: "Jean",
    nom: "Test",
    email,
    telephone: "0600000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

describe("validerCoherenceRattachementsDocument (intégration Postgres)", () => {
  it("accepte l'absence de tout rattachement", async () => {
    await expect(validerCoherenceRattachementsDocument({ bienId: "bien-1" })).resolves.toBeUndefined();
  });

  it("rejette un compromis n'appartenant pas au bien du document", async () => {
    const bienDuCompromis = await creerBienTest("[test réel] COHER-BIEN-001");
    const autreBien = await creerBienTest("[test réel] COHER-BIEN-002");
    const acquereur = await creerAcquereurTest("coher1@test.local");
    const compromis = await enregistrerCompromis({
      bienId: bienDuCompromis.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    await expect(
      validerCoherenceRattachementsDocument({ bienId: autreBien.id, compromisId: compromis.id })
    ).rejects.toThrow(/n'appartient pas au bien/);
  });

  it("rejette un acquéreur incohérent avec le compromis rattaché", async () => {
    const bien = await creerBienTest("[test réel] COHER-BIEN-003");
    const acquereur = await creerAcquereurTest("coher2@test.local");
    const autreAcquereur = await creerAcquereurTest("coher3@test.local");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    await expect(
      validerCoherenceRattachementsDocument({
        bienId: bien.id,
        compromisId: compromis.id,
        acquereurId: autreAcquereur.id,
      })
    ).rejects.toThrow(/acquéreur rattaché ne correspond pas/);
  });

  it("accepte un compromis et un acquéreur cohérents avec le bien", async () => {
    const bien = await creerBienTest("[test réel] COHER-BIEN-004");
    const acquereur = await creerAcquereurTest("coher4@test.local");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    await expect(
      validerCoherenceRattachementsDocument({
        bienId: bien.id,
        compromisId: compromis.id,
        acquereurId: acquereur.id,
      })
    ).resolves.toBeUndefined();
  });

  it("rejette un prospect vendeur n'ayant pas converti ce bien", async () => {
    const bienConverti = await creerBienTest("[test réel] COHER-BIEN-005");
    const autreBien = await creerBienTest("[test réel] COHER-BIEN-006");
    const prospect = await creerProspectVendeur({ nom: "Vendeur Test" });
    idsProspects.push(prospect.id);
    // signerMandatProspectVendeur crée son propre bien atomiquement — on utilise celui-ci comme
    // "bienConverti" réel, distinct de autreBien (jamais converti par ce prospect).
    const conversion = await signerMandatProspectVendeur(prospect.id, {
      reference: bienConverti.reference,
      titre: bienConverti.titre,
      type: bienConverti.type,
      adresse: bienConverti.adresse,
      ville: bienConverti.ville,
      codePostal: bienConverti.codePostal,
      surface: bienConverti.surface,
      pieces: bienConverti.pieces,
      prix: bienConverti.prix,
      statutMandat: bienConverti.statutMandat,
      dateMandat: bienConverti.dateMandat,
      caracteristiques: [],
      description: "",
    });
    if (conversion) idsBiens.push(conversion.bien.id);

    await expect(
      validerCoherenceRattachementsDocument({ bienId: autreBien.id, prospectVendeurId: prospect.id })
    ).rejects.toThrow(/n'est pas le vendeur/);
  });

  it("accepte un prospect vendeur cohérent avec le bien qu'il a converti", async () => {
    const prospect = await creerProspectVendeur({ nom: "Vendeur Test 2" });
    idsProspects.push(prospect.id);
    const conversion = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] COHER-BIEN-007",
      titre: "Bien converti",
      type: "appartement",
      adresse: "1 rue Test",
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
    expect(conversion).toBeDefined();
    if (!conversion) return;
    idsBiens.push(conversion.bien.id);

    await expect(
      validerCoherenceRattachementsDocument({ bienId: conversion.bien.id, prospectVendeurId: prospect.id })
    ).resolves.toBeUndefined();
  });
});
