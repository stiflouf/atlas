import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fous : ajouterOffreAction/changerStatutOffreAction doivent refuser
// explicitement (throw) sur bien/acquéreur invalides ou archivés, et changerStatutOffreAction sur
// une offre déjà résolue — même style que creerAction.test.ts / statutCommercialBien.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable, acquereurs: acquereursTable, offres: offresTable } = await import("@/db/schema");
const { creerBien, archiverBien, getBienById } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre, listerOffresPourBien } = await import("@/lib/offreRepository");
const { ajouterOffreAction, changerStatutOffreAction } = await import("./offre");

const idsOffresCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
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
    reference: `[test réel] OFFRE-ACTION-${suffixe}`,
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
    nom: `[test réel] Offre Action ${suffixe}`,
    email: `test-réel-offre-action-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "offre",
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

describe("ajouterOffreAction — garde-fous", () => {
  it("refuse explicitement (throw) une offre sur un bien archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("BIEN-ARCHIVE");
    await archiverBien(bien.id);

    await expect(
      ajouterOffreAction(
        formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "300000", dateOffre: "2026-08-01" })
      )
    ).rejects.toThrow(/bien archivé/);

    await expect(listerOffresPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) une offre pour un acquéreur archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ACQ-ARCHIVE");
    await archiverAcquereur(acquereur.id);

    await expect(
      ajouterOffreAction(
        formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "300000", dateOffre: "2026-08-01" })
      )
    ).rejects.toThrow(/acquéreur archivé/);

    await expect(listerOffresPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) un montant invalide", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("MONTANT-INVALIDE");

    await expect(
      ajouterOffreAction(
        formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "0", dateOffre: "2026-08-01" })
      )
    ).rejects.toThrow(/montant/);
  });

  it("pose offreEnCoursLe sur le bien lors d'une offre valide", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("COUPLAGE");

    await ajouterOffreAction(
      formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "310000", dateOffre: "2026-08-01" })
    ).catch(() => {});

    const offres = await listerOffresPourBien(bien.id);
    idsOffresCrees.push(...offres.map((o) => o.id));
    expect(offres).toHaveLength(1);

    const bienApres = await getBienById(bien.id);
    expect(bienApres?.offreEnCoursLe).toBeDefined();
  });
});

describe("changerStatutOffreAction — garde-fous", () => {
  it("refuse explicitement (throw) sur une offre introuvable", async () => {
    await expect(
      changerStatutOffreAction(formData({ offreId: "00000000-0000-0000-0000-000000000000", statut: "acceptee" }))
    ).rejects.toThrow(/introuvable/);
  });

  it("refuse explicitement (throw) sur un bien archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("CHANGER-BIEN-ARCHIVE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);
    await archiverBien(bien.id);

    await expect(
      changerStatutOffreAction(formData({ offreId: offre.id, statut: "acceptee" }))
    ).rejects.toThrow(/archivé/);
  });

  it("refuse explicitement (throw) un deuxième changement de statut", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLE-CHANGEMENT");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await changerStatutOffreAction(formData({ offreId: offre.id, statut: "acceptee" })).catch(() => {});

    await expect(
      changerStatutOffreAction(formData({ offreId: offre.id, statut: "refusee" }))
    ).rejects.toThrow(/statut final/);
  });

  it("ne modifie jamais offreEnCoursLe/compromisSigneLe lors d'un changement de statut", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("NON-COUPLAGE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    const bienAvant = await getBienById(bien.id);
    expect(bienAvant?.offreEnCoursLe).toBeUndefined();

    await changerStatutOffreAction(formData({ offreId: offre.id, statut: "acceptee" })).catch(() => {});

    const bienApres = await getBienById(bien.id);
    expect(bienApres?.offreEnCoursLe).toBeUndefined();
    expect(bienApres?.compromisSigneLe).toBeUndefined();
  });
});
