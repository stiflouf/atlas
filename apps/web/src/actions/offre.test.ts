import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fous : ajouterOffreAction/changerStatutOffreAction doivent refuser
// explicitement (throw) sur bien/acquéreur invalides ou archivés, et changerStatutOffreAction sur
// une offre déjà résolue — même style que creerAction.test.ts / statutCommercialBien.test.ts.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  offres: offresTable,
  comptesRendusVisite: comptesRendusVisiteTable,
} = await import("@/db/schema");
const { creerBien, archiverBien, getBienById } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre, listerOffresPourBien } = await import("@/lib/offreRepository");
const { listerLiensPourBien } = await import("@/lib/offreVisiteRepository");
const { enregistrerCompteRenduVisite } = await import("@/lib/compteRenduVisiteRepository");
const { ajouterOffreAction, changerStatutOffreAction } = await import("./offre");

const idsOffresCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];
const idsComptesRendusCrees: string[] = [];

afterAll(async () => {
  // offre_visites disparaît en cascade avec offres/comptes_rendus_visite (ADR-019), pas de
  // nettoyage explicite nécessaire pour cette table de liaison.
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

describe("ajouterOffreAction — liens visite -> offre (ADR-019)", () => {
  it("crée l'offre et son lien de visite dans le même geste", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("LIEN-VALIDE");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Retour de test.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(cr.id);

    const fd = formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" });
    fd.append("compteRenduVisiteIds", cr.id);
    await ajouterOffreAction(fd).catch(() => {});

    const offres = await listerOffresPourBien(bien.id);
    idsOffresCrees.push(...offres.map((o) => o.id));
    expect(offres).toHaveLength(1);

    const liens = await listerLiensPourBien(bien.id);
    expect(liens.map((l) => l.visite.id)).toEqual([cr.id]);
  });

  it("refuse explicitement (throw) une visite qui ne concerne pas cet acquéreur, sans créer l'offre", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("LIEN-AUTRE-ACQUEREUR-A");
    const { acquereur: autreAcquereur } = await creerBienEtAcquereurDeTest("LIEN-AUTRE-ACQUEREUR-B");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: autreAcquereur.id,
      dateVisite: "2026-08-01",
      retour: "Retour de test.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(cr.id);

    const fd = formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" });
    fd.append("compteRenduVisiteIds", cr.id);

    await expect(ajouterOffreAction(fd)).rejects.toThrow(/acquéreur/);
    await expect(listerOffresPourBien(bien.id)).resolves.toEqual([]);
  });

  it("refuse explicitement (throw) une visite postérieure à l'offre, sans créer l'offre", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("LIEN-DATE-INVALIDE");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-15",
      retour: "Retour de test.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(cr.id);

    const fd = formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" });
    fd.append("compteRenduVisiteIds", cr.id);

    await expect(ajouterOffreAction(fd)).rejects.toThrow(/postérieure/);
    await expect(listerOffresPourBien(bien.id)).resolves.toEqual([]);
  });

  // Preuve du tout-ou-rien de enregistrerOffreAvecLiensEtJalon : un même id de visite répété deux
  // fois passe la validation individuelle (existence/bien/acquéreur/date, chacune valide) mais
  // viole la contrainte unique (offreId, compteRenduVisiteId) au deuxième INSERT, à l'intérieur
  // de la transaction. Ni l'offre ni le jalon offreEnCoursLe ne doivent survivre à cet échec.
  it("annule l'offre ET le jalon offreEnCoursLe si un lien échoue pendant la transaction", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ROLLBACK-TRANSACTION");
    const cr = await enregistrerCompteRenduVisite({
      bienId: bien.id,
      acquereurId: acquereur.id,
      dateVisite: "2026-08-01",
      retour: "Retour de test.",
      interet: "interesse",
    });
    idsComptesRendusCrees.push(cr.id);

    const fd = formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" });
    fd.append("compteRenduVisiteIds", cr.id);
    fd.append("compteRenduVisiteIds", cr.id);

    await expect(ajouterOffreAction(fd)).rejects.toThrow();

    await expect(listerOffresPourBien(bien.id)).resolves.toEqual([]);
    const bienApres = await getBienById(bien.id);
    expect(bienApres?.offreEnCoursLe).toBeUndefined();
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
