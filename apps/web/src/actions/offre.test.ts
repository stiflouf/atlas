import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
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
const { enregistrerOffre, listerOffresPourBien, getOffreById } = await import("@/lib/offreRepository");
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

describe("ajouterOffreAction — doublon accidentel (ADR-044 §17-21)", () => {
  it("refuse explicitement (throw) une deuxième offre en_cours pour la même paire sans confirmation", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLON-SANS-CONFIRM");
    const premiere = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(premiere.id);

    await expect(
      ajouterOffreAction(
        formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" })
      )
    ).rejects.toThrow(/offre en cours existe déjà/);

    const offres = await listerOffresPourBien(bien.id);
    expect(offres).toHaveLength(1); // aucune deuxième offre créée
  });

  it("accepte une deuxième offre en_cours pour la même paire avec confirmation explicite — les deux coexistent", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLON-AVEC-CONFIRM");
    const premiere = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(premiere.id);

    await ajouterOffreAction(
      formData({
        bienId: bien.id,
        acquereurId: acquereur.id,
        montant: "320000",
        dateOffre: "2026-08-10",
        confirmerNouvelleOffreMalgreExistante: "oui",
      })
    ).catch(() => {});

    const offres = await listerOffresPourBien(bien.id);
    idsOffresCrees.push(...offres.filter((o) => o.id !== premiere.id).map((o) => o.id));
    expect(offres).toHaveLength(2);
    expect(offres.every((o) => o.statut === "en_cours")).toBe(true);
    // La première offre reste totalement inchangée (jamais un UPDATE, jamais un retrait
    // automatique — ADR-044 §22-23).
    const premiereApres = await getOffreById(premiere.id);
    expect(premiereApres?.montant).toBe(300000);
    expect(premiereApres?.statut).toBe("en_cours");
  });

  it("n'exige aucune confirmation si l'offre existante pour la paire n'est plus en_cours", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLON-STATUT-FINAL");
    const premiere = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(premiere.id);
    await changerStatutOffreAction(
      formData({ offreId: premiere.id, statut: "refusee", dateDecision: "2026-08-05", motifPerte: "desaccord_prix" })
    ).catch(() => {});

    await ajouterOffreAction(
      formData({ bienId: bien.id, acquereurId: acquereur.id, montant: "320000", dateOffre: "2026-08-10" })
    ).catch(() => {});

    const offres = await listerOffresPourBien(bien.id);
    idsOffresCrees.push(...offres.filter((o) => o.id !== premiere.id).map((o) => o.id));
    expect(offres.filter((o) => o.statut === "en_cours")).toHaveLength(1);
  });

  it("n'exige aucune confirmation pour un acquéreur différent sur le même bien", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DOUBLON-AUTRE-ACQUEREUR-A");
    const { acquereur: autreAcquereur } = await creerBienEtAcquereurDeTest("DOUBLON-AUTRE-ACQUEREUR-B");
    const premiere = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(premiere.id);

    await ajouterOffreAction(
      formData({ bienId: bien.id, acquereurId: autreAcquereur.id, montant: "310000", dateOffre: "2026-08-10" })
    ).catch(() => {});

    const offres = await listerOffresPourBien(bien.id);
    idsOffresCrees.push(...offres.filter((o) => o.id !== premiere.id).map((o) => o.id));
    expect(offres).toHaveLength(2);
  });
});

describe("changerStatutOffreAction — garde-fous", () => {
  it("refuse explicitement (throw) sur une offre introuvable", async () => {
    await expect(
      changerStatutOffreAction(
        formData({ offreId: "00000000-0000-0000-0000-000000000000", statut: "acceptee", dateDecision: "2026-08-01" })
      )
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
      changerStatutOffreAction(formData({ offreId: offre.id, statut: "acceptee", dateDecision: "2026-08-05" }))
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

    await changerStatutOffreAction(
      formData({ offreId: offre.id, statut: "acceptee", dateDecision: "2026-08-05" })
    ).catch(() => {});

    await expect(
      changerStatutOffreAction(
        formData({ offreId: offre.id, statut: "refusee", dateDecision: "2026-08-06", motifPerte: "autre" })
      )
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

    await changerStatutOffreAction(
      formData({ offreId: offre.id, statut: "acceptee", dateDecision: "2026-08-05" })
    ).catch(() => {});

    const bienApres = await getBienById(bien.id);
    expect(bienApres?.offreEnCoursLe).toBeUndefined();
    expect(bienApres?.compromisSigneLe).toBeUndefined();
  });

  it("refuse explicitement (throw) une transition sans dateDecision — aucune écriture (ADR-020)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("SANS-DATE-DECISION");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await expect(
      changerStatutOffreAction(formData({ offreId: offre.id, statut: "acceptee" }))
    ).rejects.toThrow(/date de décision/);

    const inchangee = await getOffreById(offre.id);
    expect(inchangee?.statut).toBe("en_cours");
  });

  it("refuse explicitement (throw) refusee/retiree sans motifPerte valide — aucune écriture", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("SANS-MOTIF");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await expect(
      changerStatutOffreAction(formData({ offreId: offre.id, statut: "refusee", dateDecision: "2026-08-06" }))
    ).rejects.toThrow(/motif/);

    const inchangee = await getOffreById(offre.id);
    expect(inchangee?.statut).toBe("en_cours");
    expect(inchangee?.motifPerte).toBeUndefined();
  });

  it("refuse explicitement (throw) un motifPerte fourni pour acceptee — jamais laissé sur une offre acceptée", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("MOTIF-SUR-ACCEPTEE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await expect(
      changerStatutOffreAction(
        formData({ offreId: offre.id, statut: "acceptee", dateDecision: "2026-08-06", motifPerte: "desaccord_prix" })
      )
    ).rejects.toThrow(/n'a pas de sens/);

    const inchangee = await getOffreById(offre.id);
    expect(inchangee?.statut).toBe("en_cours");
  });

  it("refuse une offre pour un motif hors vocabulaire — aucune écriture", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("MOTIF-INVALIDE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await expect(
      changerStatutOffreAction(
        formData({ offreId: offre.id, statut: "retiree", dateDecision: "2026-08-06", motifPerte: "n'importe quoi" })
      )
    ).rejects.toThrow(/motif/);

    const inchangee = await getOffreById(offre.id);
    expect(inchangee?.statut).toBe("en_cours");
  });

  it("pose dateDecision et motifPerte sur une offre retirée valide", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("RETIREE-VALIDE");
    const offre = await enregistrerOffre({
      bienId: bien.id,
      acquereurId: acquereur.id,
      montant: 300000,
      dateOffre: "2026-08-01",
    });
    idsOffresCrees.push(offre.id);

    await changerStatutOffreAction(
      formData({ offreId: offre.id, statut: "retiree", dateDecision: "2026-08-07", motifPerte: "acquereur_se_retire" })
    ).catch(() => {});

    const apres = await getOffreById(offre.id);
    expect(apres?.statut).toBe("retiree");
    expect(apres?.dateDecision).toBe("2026-08-07");
    expect(apres?.motifPerte).toBe("acquereur_se_retire");
  });
});
