import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : les FK compromis -> biens/acquereurs/offres imposent des ids réels, donc
// un mock ne suffit pas ici. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts
// (Postgres local de dev) si non défini par l'environnement — même principe que
// offreRepository.test.ts. Bien/acquéreur créés dédiés à ce fichier (pas une ligne réelle
// arbitraire piochée sans tri) pour éviter toute course avec d'autres suites d'intégration.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  compromis: compromisTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { enregistrerOffre, changerStatutOffre } = await import("./offreRepository");
const {
  listerCompromisPourBien,
  listerCompromisPourAcquereur,
  getCompromisById,
  enregistrerCompromis,
  marquerCompromisAnnule,
  marquerCompromisRealise,
} = await import("./compromisRepository");

const idsCompromisCrees: string[] = [];
const idsOffresCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
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
    reference: `[test réel] COMPROMIS-${suffixe}`,
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
    nom: `[test réel] Compromis ${suffixe}`,
    email: `test-réel-compromis-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  return { bien, acquereur };
}

describe("compromisRepository (intégration Postgres)", () => {
  it("retourne [] pour un id non-UUID (bien/acquéreur mocké), sans erreur de cast", async () => {
    await expect(listerCompromisPourBien("bien-001")).resolves.toEqual([]);
    await expect(listerCompromisPourAcquereur("client-001")).resolves.toEqual([]);
  });

  it("getCompromisById() retourne undefined pour un id non-UUID ou inexistant", async () => {
    await expect(getCompromisById("compromis-mock")).resolves.toBeUndefined();
    await expect(getCompromisById("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });

  it("enregistrerCompromis() persiste avec statut 'en_cours' par défaut, sans offreId, listerCompromisPourBien()/listerCompromisPourAcquereur() le retrouvent triée DESC", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("001");

    const ancien = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 400000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(ancien.id);
    expect(ancien.statut).toBe("en_cours");
    expect(ancien.offreId).toBeUndefined();
    expect(ancien.dateActe).toBeUndefined();

    const recent = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 420000,
      dateSignature: "2026-08-10",
      dateActe: "2026-10-01",
    });
    idsCompromisCrees.push(recent.id);
    expect(recent.dateActe).toBe("2026-10-01");

    const pourBien = await listerCompromisPourBien(bien.id);
    expect(pourBien.map((c) => c.id)).toEqual([recent.id, ancien.id]);

    const pourAcquereur = await listerCompromisPourAcquereur(acquereur.id);
    expect(pourAcquereur.map((c) => c.id)).toEqual([recent.id, ancien.id]);
  });

  it("enregistrerCompromis() persiste offreId quand fourni", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("002");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 450000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: offre.id,
      prixConvenu: 450000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(compromisCree.id);

    expect(compromisCree.offreId).toBe(offre.id);
  });

  it("marquerCompromisAnnule() pose atomiquement statut='annule', dateAnnulation et motifAnnulation, le reste des champs reste immuable (ADR-020)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("003");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 350000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(compromisCree.id);

    const annule = await marquerCompromisAnnule(compromisCree.id, "2026-08-12", "desaccord_prix");

    expect(annule?.statut).toBe("annule");
    expect(annule?.dateAnnulation).toBe("2026-08-12");
    expect(annule?.motifAnnulation).toBe("desaccord_prix");
    expect(annule?.prixConvenu).toBe(350000);
    expect(annule?.acquereurId).toBe(acquereur.id);
    expect(annule?.bienId).toBe(bien.id);
    expect(annule?.dateSignature).toBe("2026-08-05");
    expect(annule?.dateActeReelle).toBeUndefined();
  });

  it("marquerCompromisAnnule() retourne undefined pour un id non-UUID ou inexistant", async () => {
    await expect(marquerCompromisAnnule("compromis-mock", "2026-08-12", "autre")).resolves.toBeUndefined();
    await expect(
      marquerCompromisAnnule("00000000-0000-0000-0000-000000000000", "2026-08-12", "autre")
    ).resolves.toBeUndefined();
  });

  it("marquerCompromisRealise() pose atomiquement statut='realise' et dateActeReelle, sans toucher dateActe (prévue)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("004");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 360000,
      dateSignature: "2026-08-05",
      dateActe: "2026-10-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    const realise = await marquerCompromisRealise(compromisCree.id, "2026-10-15");

    expect(realise?.statut).toBe("realise");
    expect(realise?.dateActeReelle).toBe("2026-10-15");
    expect(realise?.dateActe).toBe("2026-10-01");
    expect(realise?.prixConvenu).toBe(360000);
  });

  it("marquerCompromisRealise() fonctionne même sans dateActe (prévue) préalable", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("005");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 340000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(compromisCree.id);
    expect(compromisCree.dateActe).toBeUndefined();

    const realise = await marquerCompromisRealise(compromisCree.id, "2026-09-20");

    expect(realise?.statut).toBe("realise");
    expect(realise?.dateActeReelle).toBe("2026-09-20");
    expect(realise?.dateActe).toBeUndefined();
  });

  it("marquerCompromisRealise() retourne undefined pour un id non-UUID ou inexistant", async () => {
    await expect(marquerCompromisRealise("compromis-mock", "2026-09-20")).resolves.toBeUndefined();
    await expect(
      marquerCompromisRealise("00000000-0000-0000-0000-000000000000", "2026-09-20")
    ).resolves.toBeUndefined();
  });
});
