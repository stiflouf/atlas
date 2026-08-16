import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

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
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
} = await import("@/db/schema");
const { creerBien, archiverBien, getBienById, annulerCompromis: annulerCompromisJalonLegacy } = await import(
  "@/lib/bienRepository"
);
const { deriverStatutCommercial } = await import("@/lib/statutCommercialBien");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerOffre, changerStatutOffre } = await import("@/lib/offreRepository");
const { enregistrerCompromis, listerCompromisPourBien, getCompromisById, marquerCompromisRealise, marquerCompromisAnnule } =
  await import("@/lib/compromisRepository");
const { ajouterCompromisAction, changerStatutCompromisAction, modifierDateActeAction } = await import("./compromis");

const idsCompromisCrees: string[] = [];
const idsOffresCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  // ajouterCompromisAction émet un événement compromis_signe (ADR-032) — evenements_metier ne
  // cascade jamais depuis sa source (correction n°5, append-only) : à purger avant le compromis
  // lui-même, sinon la suppression échoue (violation de clé étrangère).
  if (idsCompromisCrees.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.compromisId, idsCompromisCrees));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
  }
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
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

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
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

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
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

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

describe("ajouterCompromisAction — offre déjà utilisée par un compromis (ADR-045 §16-17)", () => {
  it("refuse explicitement (throw) une offre déjà associée à un compromis, aucune confirmation possible pour contourner", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("OFFRE-DEJA-UTILISEE");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

    const premierCompromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: offre.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(premierCompromis.id);
    // Passé à 'realise' pour isoler précisément la garde offre-déjà-utilisée de la garde
    // "en_cours par bien" (distincte, déjà testée séparément ci-dessus) — sans cela, la garde
    // bien-level bloquerait la création en premier et masquerait celle testée ici.
    const { marquerCompromisRealise } = await import("@/lib/compromisRepository");
    await marquerCompromisRealise(premierCompromis.id, "2026-09-01");

    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: offre.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-06",
        })
      )
    ).rejects.toThrow(/déjà associée à un compromis/);

    // Un seul compromis référence cette offre — aucun second créé.
    const compromisListe = await listerCompromisPourBien(bien.id);
    expect(compromisListe).toHaveLength(1);
  });

  it("refuse même si le compromis existant référençant l'offre n'est plus en_cours (garde offre distincte de la garde en_cours par bien)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("OFFRE-DEJA-UTILISEE-ANNULE");
    const offre = await enregistrerOffre({ bienId: bien.id, acquereurId: acquereur.id, montant: 300000, dateOffre: "2026-08-01" });
    idsOffresCrees.push(offre.id);
    await changerStatutOffre(offre.id, { statut: "acceptee", dateDecision: "2026-08-02" });

    const premierCompromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      offreId: offre.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-05",
    });
    idsCompromisCrees.push(premierCompromis.id);
    const { marquerCompromisAnnule } = await import("@/lib/compromisRepository");
    await marquerCompromisAnnule(premierCompromis.id, "2026-08-07", "desaccord_prix");

    // Le compromis annulé ne bloque plus la garde "en_cours par bien", mais l'offre reste
    // structurellement déjà utilisée — garde distincte, toujours appliquée.
    await expect(
      ajouterCompromisAction(
        formData({
          bienId: bien.id,
          acquereurId: acquereur.id,
          offreId: offre.id,
          prixConvenu: "300000",
          dateSignature: "2026-08-08",
        })
      )
    ).rejects.toThrow(/déjà associée à un compromis/);
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

  it("refuse explicitement (throw) le passage à annule sans dateAnnulation — aucune écriture (ADR-020)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ANNULE-SANS-DATE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    await expect(
      changerStatutCompromisAction(
        formData({ compromisId: compromisCree.id, statut: "annule", motifAnnulation: "autre" })
      )
    ).rejects.toThrow(/date d'annulation/);

    const inchange = await getCompromisById(compromisCree.id);
    expect(inchange?.statut).toBe("en_cours");
    expect(inchange?.dateAnnulation).toBeUndefined();
  });

  it("refuse explicitement (throw) le passage à annule sans motifAnnulation valide — aucune écriture", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ANNULE-SANS-MOTIF");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    await expect(
      changerStatutCompromisAction(
        formData({ compromisId: compromisCree.id, statut: "annule", dateAnnulation: "2026-08-15" })
      )
    ).rejects.toThrow(/motif/);

    const inchange = await getCompromisById(compromisCree.id);
    expect(inchange?.statut).toBe("en_cours");
    expect(inchange?.motifAnnulation).toBeUndefined();
  });

  it("annule avec dateAnnulation et motifAnnulation valides, en conservant les autres champs", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ANNULE-VALIDE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromisCree.id);

    await changerStatutCompromisAction(
      formData({
        compromisId: compromisCree.id,
        statut: "annule",
        dateAnnulation: "2026-08-15",
        motifAnnulation: "financement_refuse",
      })
    ).catch(() => {});

    const apres = await getCompromisById(compromisCree.id);
    expect(apres?.statut).toBe("annule");
    expect(apres?.dateAnnulation).toBe("2026-08-15");
    expect(apres?.motifAnnulation).toBe("financement_refuse");
    expect(apres?.prixConvenu).toBe(300000);
  });
});

describe("statut commercial du Bien — priorité au modèle structuré (ADR-046 §26/42)", () => {
  it("compromis structuré en_cours réel + jalon legacy effacé manuellement via l'ancien mécanisme -> statut reste compromis_signe", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("LEGACY-JALON-EFFACE");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromis.id);

    // Simule exactement le vieux parcours indépendant (src/actions/statutCommercialBien.ts,
    // annulerCompromisAction) : efface le jalon legacy SANS jamais toucher la ligne compromis
    // structurée elle-même (les deux mécanismes sont totalement disjoints).
    await annulerCompromisJalonLegacy(bien.id);
    const bienApres = await getBienById(bien.id);
    expect(bienApres?.compromisSigneLe).toBeUndefined();

    const compromisDuBien = await listerCompromisPourBien(bien.id);
    expect(deriverStatutCommercial(bienApres!, compromisDuBien)).toBe("compromis_signe");
  });

  it("compromis structuré annulé via le vrai parcours + jalon legacy jamais effacé -> statut n'affiche plus compromis_signe (test de régression principal)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("ANNULATION-STRUCTUREE");
    const compromis = await enregistrerCompromis({
      bienId: bien.id,
      acquereurId: acquereur.id,
      prixConvenu: 300000,
      dateSignature: "2026-08-01",
    });
    idsCompromisCrees.push(compromis.id);
    // enregistrerCompromis() seul (repository, utilisé ci-dessus sans passer par la Server Action)
    // ne pose pas compromisSigneLe — reproduit explicitement l'état laissé par le vrai parcours
    // ajouterCompromisAction (qui pose ce jalon dans la même transaction, ADR-016).
    const { marquerCompromisSigne } = await import("@/lib/bienRepository");
    await marquerCompromisSigne(bien.id);
    const bienAvantAnnulation = await getBienById(bien.id);
    expect(bienAvantAnnulation?.compromisSigneLe).toBeDefined();

    await changerStatutCompromisAction(
      formData({ compromisId: compromis.id, statut: "annule", dateAnnulation: "2026-08-10", motifAnnulation: "desaccord_prix" })
    ).catch(() => {});

    // Le jalon legacy n'a jamais été touché par la transition structurée (comportement
    // volontairement inchangé, §27 du brief) — la correction vit entièrement dans la dérivation.
    const bienApres = await getBienById(bien.id);
    expect(bienApres?.compromisSigneLe).toBeDefined();

    const compromisDuBien = await listerCompromisPourBien(bien.id);
    expect(deriverStatutCommercial(bienApres!, compromisDuBien)).not.toBe("compromis_signe");
  });
});

describe("modifierDateActeAction — garde-fous (ADR-046)", () => {
  it("renseigne une date d'acte absente sur un compromis en_cours", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-RENSEIGNER");
    const compromisCree = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05" });
    idsCompromisCrees.push(compromisCree.id);
    expect(compromisCree.dateActe).toBeUndefined();

    await modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "2026-10-15" })).catch(() => {});

    const apres = await getCompromisById(compromisCree.id);
    expect(apres?.dateActe).toBe("2026-10-15");
  });

  it("reporte une date d'acte existante (A -> B)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-REPORTER");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05", dateActe: "2026-10-15",
    });
    idsCompromisCrees.push(compromisCree.id);

    await modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "2026-11-02" })).catch(() => {});

    const apres = await getCompromisById(compromisCree.id);
    expect(apres?.dateActe).toBe("2026-11-02");
  });

  it("efface une date d'acte devenue inconnue (champ vide -> NULL, jamais une estimation inventée)", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-EFFACER");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05", dateActe: "2026-10-15",
    });
    idsCompromisCrees.push(compromisCree.id);

    await modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "" })).catch(() => {});

    const apres = await getCompromisById(compromisCree.id);
    expect(apres?.dateActe).toBeUndefined();
  });

  it("refuse explicitement (throw) la modification sur un compromis realise", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-REALISE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05", dateActe: "2026-10-15",
    });
    idsCompromisCrees.push(compromisCree.id);
    await marquerCompromisRealise(compromisCree.id, "2026-10-16");

    await expect(
      modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "2026-12-01" }))
    ).rejects.toThrow(/en cours/);

    const inchange = await getCompromisById(compromisCree.id);
    expect(inchange?.dateActe).toBe("2026-10-15");
  });

  it("refuse explicitement (throw) la modification sur un compromis annule", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-ANNULE");
    const compromisCree = await enregistrerCompromis({
      bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05", dateActe: "2026-10-15",
    });
    idsCompromisCrees.push(compromisCree.id);
    await marquerCompromisAnnule(compromisCree.id, "2026-09-01", "desaccord_prix");

    await expect(
      modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "2026-12-01" }))
    ).rejects.toThrow(/en cours/);

    const inchange = await getCompromisById(compromisCree.id);
    expect(inchange?.dateActe).toBe("2026-10-15");
  });

  it("refuse explicitement (throw) une race : compromis devenu réalisé entre le GET affiché et le POST", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-RACE");
    const compromisCree = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05" });
    idsCompromisCrees.push(compromisCree.id);

    // Simule un GET qui a affiché le formulaire alors que le compromis était encore en_cours,
    // puis un changement d'état survenu avant la soumission — la Server Action doit relire l'état
    // réel, jamais faire confiance à un instantané côté client.
    await marquerCompromisRealise(compromisCree.id, "2026-09-01");

    await expect(
      modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "2026-12-01" }))
    ).rejects.toThrow(/en cours/);
  });

  it("refuse explicitement (throw) sur un bien archivé", async () => {
    const { bien, acquereur } = await creerBienEtAcquereurDeTest("DATEACTE-BIEN-ARCHIVE");
    const compromisCree = await enregistrerCompromis({ bienId: bien.id, acquereurId: acquereur.id, prixConvenu: 300000, dateSignature: "2026-08-05" });
    idsCompromisCrees.push(compromisCree.id);
    await archiverBien(bien.id);

    await expect(
      modifierDateActeAction(formData({ compromisId: compromisCree.id, dateActe: "2026-12-01" }))
    ).rejects.toThrow(/archivé/);
  });
});
