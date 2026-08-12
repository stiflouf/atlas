import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fous : ajouterCompromisAction/changerStatutCompromisAction doivent
// refuser explicitement (throw) sur bien/acquéreur invalides ou archivés, sur une offre liée
// incohérente, sur un compromis déjà en_cours pour le bien, et sur un compromis déjà résolu —
// même style que offre.test.ts / statutCommercialBien.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  compromis: compromisTable,
} = await import("@/db/schema");
const { creerBien, archiverBien, getBienById } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre, changerStatutOffre } = await import("@/lib/offreRepository");
const { enregistrerCompromis, listerCompromisPourBien, getCompromisById } = await import(
  "@/lib/compromisRepository"
);
const { ajouterCompromisAction, changerStatutCompromisAction } = await import("./compromis");

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
    reference: `[test réel] COMPROMIS-ACTION-${suffixe}`,
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
    nom: `[test réel] Compromis Action ${suffixe}`,
    email: `test-réel-compromis-action-${suffixe}@example.com`,
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

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("ajouterCompromisAction — garde-fous", () => {
  it("refuse explicitement (throw) un compromis sur un bien archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("BIEN-ARCHIVE");
    await archiverBien(bien.id);

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-01",
        })
      )
    ).rejects.toThrow(/bien archivé/);

    await expect(listerCompromisPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) un compromis pour un acquéreur archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACQ-ARCHIVE");
    await archiverAcquereur(acquereur.id);

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-01",
        })
      )
    ).rejects.toThrow(/acquéreur archivé/);

    await expect(listerCompromisPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) un prix convenu invalide", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("PRIX-INVALIDE");

    await expect(
      ajouterCompromisAction(
        formData({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: "0", dateSignature: "2026-08-01" })
      )
    ).rejects.toThrow(/prix convenu/);
  });

  it("refuse explicitement (throw) si un compromis est déjà en_cours pour ce bien", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DEJA-EN-COURS");
    const premier = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(premier.id);

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          prixConvenu: "310000",
          dateSignature: "2026-08-02",
        })
      )
    ).rejects.toThrow(/déjà en cours/);

    await expect(listerCompromisPourBien(bien.id)).resolves.toHaveLength(1);
  });

  it("refuse explicitement (throw) une offre liée introuvable", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("OFFRE-INTROUVABLE");

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: "00000000-0000-0000-0000-000000000000",
          prixConvenu: "300000",
          dateSignature: "2026-08-01",
        })
      )
    ).rejects.toThrow(/[Oo]ffre introuvable/);
  });

  it("refuse explicitement (throw) une offre liée d'un autre bien", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("OFFRE-AUTRE-BIEN");
    const { bien: autreBien } = await creerBienEtAcquereurDeTest("OFFRE-AUTRE-BIEN-2");
    const offre = await enregistrerOffre({
      bienId: autreBien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, "acceptee");

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: offre.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-01",
        })
      )
    ).rejects.toThrow(/ne concerne pas ce bien/);
  });

  it("refuse explicitement (throw) une offre liée d'un autre acquéreur", async () => {
    const { bien, acquereur: autreAcquereur } = await creerBienEtAcquereurDeTest("OFFRE-AUTRE-ACQ-BIEN");
    const { acquereur } = await creerBienEtAcquereurDeTest("OFFRE-AUTRE-ACQ");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: autreAcquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, "acceptee");

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: offre.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-01",
        })
      )
    ).rejects.toThrow(/ne concerne pas cet acquéreur/);
  });

  it("refuse explicitement (throw) une offre liée qui n'est pas acceptee", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("OFFRE-PAS-ACCEPTEE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: offre.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-01",
        })
      )
    ).rejects.toThrow(/n'est pas acceptée/);
  });

  it("pose compromisSigneLe sur le bien et accepte une offre liée cohérente", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("COUPLAGE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 320000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, "acceptee");

    await ajouterCompromisAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        offreId: offre.id,
        prixConvenu: "320000",
        dateSignature: "2026-08-05",
      })
    ).catch(() => {});

    const compromisListe = await listerCompromisPourBien(bien.id);
    idsCompromisCrees.push(...compromisListe.map((c) => c.id));
    expect(compromisListe).toHaveLength(1);
    expect(compromisListe[0].offreId).toBe(offre.id);

    const bienApres = await getBienById(bien.id);
    expect(bienApres?.compromisSigneLe).toBeDefined();
  });
});

describe("changerStatutCompromisAction — garde-fous", () => {
  it("refuse explicitement (throw) sur un compromis introuvable", async () => {
    await expect(
      changerStatutCompromisAction(
        formData({ compromisId: "00000000-0000-0000-0000-000000000000", statut: "realise" })
      )
    ).rejects.toThrow(/introuvable/);
  });

  it("refuse explicitement (throw) sur un bien archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("CHANGER-BIEN-ARCHIVE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);
    await archiverBien(bien.id);

    await expect(
      changerStatutCompromisAction(formData({ compromisId: compromisCree.id, statut: "realise" }))
    ).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) un deuxième changement de statut", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLE-CHANGEMENT");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    await changerStatutCompromisAction(
      formData({ compromisId: compromisCree.id, statut: "realise", dateActeReelle: "2026-09-01" })
    ).catch(() => {});

    await expect(
      changerStatutCompromisAction(formData({ compromisId: compromisCree.id, statut: "annule" }))
    ).rejects.toThrow(/statut final/);
  });

  it("ne modifie jamais compromisSigneLe lors d'un changement de statut", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("NON-COUPLAGE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    const bienAvant = await getBienById(bien.id);
    expect(bienAvant?.compromisSigneLe).toBeUndefined();

    await changerStatutCompromisAction(
      formData({ compromisId: compromisCree.id, statut: "realise", dateActeReelle: "2026-09-01" })
    ).catch(() => {});

    const bienApres = await getBienById(bien.id);
    expect(bienApres?.compromisSigneLe).toBeUndefined();
  });

  it("refuse explicitement (throw) le passage à realise sans dateActeReelle — aucune écriture", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REALISE-SANS-DATE-REELLE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    await expect(
      changerStatutCompromisAction(formData({ compromisId: compromisCree.id, statut: "realise" }))
    ).rejects.toThrow(/date réelle/);

    const inchange = await getCompromisById(compromisCree.id);
    expect(inchange?.statut).toBe("en_cours");
    expect(inchange?.dateActeReelle).toBeUndefined();
  });

  it("marque réalisé avec dateActeReelle, en conservant dateActe (prévue) telle quelle", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("REALISE-AVEC-DATE-REELLE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
      dateActe: "2026-10-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    await changerStatutCompromisAction(
      formData({ compromisId: compromisCree.id, statut: "realise", dateActeReelle: "2026-10-08" })
    ).catch(() => {});

    const apres = await getCompromisById(compromisCree.id);
    expect(apres?.statut).toBe("realise");
    expect(apres?.dateActeReelle).toBe("2026-10-08");
    expect(apres?.dateActe).toBe("2026-10-01");
  });
});
