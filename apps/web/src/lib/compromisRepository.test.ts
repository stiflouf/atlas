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
  getCompromisParOffreId,
  enregistrerCompromis,
  marquerCompromisAnnule,
  marquerCompromisRealise,
  modifierDateActeCompromis,
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

    // ADR-047 : un seul compromis 'en_cours' par bien est désormais imposé en base (index unique
    // partiel) — bascule le premier avant d'en créer un second, comme un vrai dossier réel où le
    // premier tomberait avant qu'un second ne soit signé.
    await marquerCompromisAnnule(ancien.id, "2026-08-05", "desaccord_prix");

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

  it("getCompromisParOffreId() retourne undefined pour un id non-UUID, sans erreur de cast", async () => {
    await expect(getCompromisParOffreId("offre-mock")).resolves.toBeUndefined();
  });

  it("getCompromisParOffreId() retourne undefined quand aucun compromis ne référence l'offre (ADR-045)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("006");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);

    await expect(getCompromisParOffreId(offre.id)).resolves.toBeUndefined();
  });

  it("getCompromisParOffreId() retourne le compromis exact quand un seul le référence (ADR-045)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("007");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 310000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: offre.id,
      prixConvenu: 310000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(compromisCree.id);

    const resultat = await getCompromisParOffreId(offre.id);
    expect(resultat?.id).toBe(compromisCree.id);
  });

  // ADR-047 : UNIQUE(offre_id) a été ajoutée en défense en profondeur avant exposition Internet — le
  // scénario "plusieurs compromis pour la même offre" est désormais rejeté dès l'écriture par la
  // contrainte elle-même, plus tôt que la lecture fail-closed qui protégeait ce cas auparavant.
  // Réécrit pour vérifier cette garantie plus forte (le premier compromis est basculé 'annule' pour
  // isoler la contrainte testée ici de l'index partiel "un seul en_cours par bien", couvert séparément
  // dans ce fichier).
  it("UNIQUE(offre_id) empêche désormais qu'un second compromis référence la même offre (ADR-047)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("008");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 320000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

    const c1 = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, offreId: offre.id, prixConvenu: 320000, dateSignature: "2026-08-05" });
    idsCompromisCrees.push(c1.id);
    await marquerCompromisAnnule(c1.id, "2026-08-06", "desaccord_prix");

    // drizzle-orm/postgres-js enveloppe l'erreur Postgres d'origine dans `cause` — le message de
    // haut niveau ne contient jamais le nom de la contrainte (vérifié empiriquement, même
    // observation que secteurRecherche.ts, ADR-028).
    let erreurCapturee: unknown;
    try {
      await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, offreId: offre.id, prixConvenu: 320000, dateSignature: "2026-08-06" });
    } catch (erreur) {
      erreurCapturee = erreur;
    }
    expect(erreurCapturee).toBeInstanceOf(Error);
    const cause = (erreurCapturee as Error).cause as { constraint_name?: string } | undefined;
    expect(cause?.constraint_name).toBe("compromis_offre_id_unique");

    const resultat = await getCompromisParOffreId(offre.id);
    expect(resultat?.id).toBe(c1.id);
  });

  it("modifierDateActeCompromis() retourne undefined pour un id non-UUID, sans erreur de cast", async () => {
    await expect(modifierDateActeCompromis("compromis-mock", "2026-10-15")).resolves.toBeUndefined();
  });

  it("modifierDateActeCompromis() renseigne une date d'acte absente (ADR-046)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("009");
    const compromisCree = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05" });
    idsCompromisCrees.push(compromisCree.id);
    expect(compromisCree.dateActe).toBeUndefined();

    const modifie = await modifierDateActeCompromis(compromisCree.id, "2026-10-15");
    expect(modifie?.dateActe).toBe("2026-10-15");
  });

  it("modifierDateActeCompromis() reporte une date d'acte existante (ADR-046)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("010");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05", dateActe: "2026-10-15",
    });
    idsCompromisCrees.push(compromisCree.id);

    const modifie = await modifierDateActeCompromis(compromisCree.id, "2026-11-02");
    expect(modifie?.dateActe).toBe("2026-11-02");
  });

  it("modifierDateActeCompromis() efface une date d'acte devenue inconnue (undefined -> NULL, ADR-046)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("011");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05", dateActe: "2026-10-15",
    });
    idsCompromisCrees.push(compromisCree.id);

    const modifie = await modifierDateActeCompromis(compromisCree.id, undefined);
    expect(modifie?.dateActe).toBeUndefined();
  });
});
