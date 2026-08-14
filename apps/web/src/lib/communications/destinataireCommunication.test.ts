import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  prospectsVendeurs: prospectsVendeursTable,
  documentsBien: documentsBienTable,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { creerProspectVendeur, signerMandatProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerDocumentBien } = await import("@/lib/documentBienRepository");
const { resoudreDestinatairesDepuisBien, resoudreDestinatairesDepuisDocument } = await import(
  "./destinataireCommunication"
);

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsCompromis: string[] = [];
const idsProspects: string[] = [];
const idsDocuments: string[] = [];

afterAll(async () => {
  for (const id of idsDocuments) await getDb().delete(documentsBienTable).where(eq(documentsBienTable.id, id));
  for (const id of idsCompromis) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsProspects) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
});

async function creerBienTest(reference: string) {
  const bien = await creerBien({
    reference,
    titre: "Bien de test communications",
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
    nom: "Martin",
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

describe("resoudreDestinatairesDepuisBien", () => {
  it("aucun candidat si ni vendeur ni compromis", async () => {
    const bien = await creerBienTest("[test réel] COMM-BIEN-001");
    await expect(resoudreDestinatairesDepuisBien(bien.id)).resolves.toEqual([]);
  });

  it("un seul candidat vendeur si aucun compromis n'existe", async () => {
    const prospect = await creerProspectVendeur({ nom: "Dupont" });
    idsProspects.push(prospect.id);
    const conversion = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] COMM-BIEN-002",
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

    const candidats = await resoudreDestinatairesDepuisBien(conversion.bien.id);
    expect(candidats).toHaveLength(1);
    expect(candidats[0]).toMatchObject({ type: "prospectVendeur", nom: "Dupont" });
  });

  it("deux candidats (vendeur + acquéreur) si les deux existent sur le même bien — jamais tranché arbitrairement", async () => {
    const prospect = await creerProspectVendeur({ nom: "Petit" });
    idsProspects.push(prospect.id);
    const conversion = await signerMandatProspectVendeur(prospect.id, {
      reference: "[test réel] COMM-BIEN-003",
      titre: "Bien avec vendeur et acquéreur",
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

    const acquereur = await creerAcquereurTest("comm1@test.local");
    const compromis = await enregistrerCompromis({
      bienId: conversion.bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-02-01",
    });
    idsCompromis.push(compromis.id);

    const candidats = await resoudreDestinatairesDepuisBien(conversion.bien.id);
    expect(candidats).toHaveLength(2);
    expect(candidats.map((c) => c.type).sort()).toEqual(["acquereur", "prospectVendeur"]);
  });
});

describe("resoudreDestinatairesDepuisDocument", () => {
  it("présélectionne l'acquéreur si le document porte uniquement acquereurId", async () => {
    const bien = await creerBienTest("[test réel] COMM-DOC-001");
    const acquereur = await creerAcquereurTest("comm2@test.local");
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "CNI",
      categorie: "autre",
      nomFichierOriginal: "cni.pdf",
      cleStockage: "cle-comm-1",
      tailleOctets: 10,
      typeMime: "application/pdf",
      acquereurId: acquereur.id,
      etatVerification: "confirme",
    });
    idsDocuments.push(document.id);

    const candidats = await resoudreDestinatairesDepuisDocument(document, bien.id);
    expect(candidats).toHaveLength(1);
    expect(candidats[0]).toMatchObject({ type: "acquereur", id: acquereur.id });
  });

  it("aucune présélection si le document porte les deux rattachements à la fois (ambigu) — repli sur le bien", async () => {
    const bien = await creerBienTest("[test réel] COMM-DOC-002");
    const acquereur = await creerAcquereurTest("comm3@test.local");
    const prospect = await creerProspectVendeur({ nom: "Ambigu" });
    idsProspects.push(prospect.id);
    const document = await enregistrerDocumentBien({
      bienId: bien.id,
      nom: "Document ambigu",
      categorie: "autre",
      nomFichierOriginal: "doc.pdf",
      cleStockage: "cle-comm-2",
      tailleOctets: 10,
      typeMime: "application/pdf",
      acquereurId: acquereur.id,
      // prospectVendeurId volontairement non cohérent ici (test de résolution uniquement, pas de
      // cohérence ADR-029) — mais la fonction doit refuser de présélectionner dès que les deux
      // champs sont renseignés, quelle que soit leur validité par ailleurs.
      prospectVendeurId: prospect.id,
      etatVerification: "confirme",
    });
    idsDocuments.push(document.id);

    const candidats = await resoudreDestinatairesDepuisDocument(document, bien.id);
    // Repli sur le bien : ni vendeur (non converti pour CE bien) ni compromis -> aucun candidat.
    expect(candidats).toEqual([]);
  });

  it("aucun document -> repli direct sur le bien", async () => {
    const bien = await creerBienTest("[test réel] COMM-DOC-003");
    const candidats = await resoudreDestinatairesDepuisDocument(undefined, bien.id);
    expect(candidats).toEqual([]);
  });
});
