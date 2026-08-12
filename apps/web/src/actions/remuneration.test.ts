import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration + garde-fous : ajouterRemunerationAction/modifierRemunerationAction/
// marquerRemunerationEncaisseeAction doivent refuser explicitement (throw) sur les invariants
// d'ADR-021 — même style que compromis.test.ts. Attention particulière à l'exception d'archivage
// (point 6/ADR-021) : un compromis realise reste accessible après archivage du bien/acquéreur,
// contrairement à un compromis en_cours.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  remuneration: remunerationTable,
} = await import("@/db/schema");
const { creerBien, archiverBien } = await import("@/lib/bienRepository");
const { creerAcquereur, archiverAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis, marquerCompromisRealise, marquerCompromisAnnule } = await import(
  "@/lib/compromisRepository"
);
const { enregistrerRemuneration, getRemunerationParCompromis, marquerRemunerationEncaissee } = await import(
  "@/lib/remunerationRepository"
);
const { ajouterRemunerationAction, modifierRemunerationAction, marquerRemunerationEncaisseeAction } =
  await import("./remuneration");

const idsRemunerationCrees: string[] = [];
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  for (const id of idsRemunerationCrees) {
    await getDb().delete(remunerationTable).where(eq(remunerationTable.id, id));
  }
  for (const id of idsCompromisCrees) {
    await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  }
  for (const id of idsBiensCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
  for (const id of idsAcquereursCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

async function creerCompromisDeTest(suffixe: string) {
  const bien = await creerBien({
    reference: `[test réel] REMUNERATION-ACTION-${suffixe}`,
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
    nom: `[test réel] Rémunération Action ${suffixe}`,
    email: `test-réel-remuneration-action-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2026-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const compromis = await enregistrerCompromis({
    bienId: bien.id,
    acquereurId: acquereur.id,
    prixConvenu: 300000,
    dateSignature: "2026-08-01",
  });
  idsCompromisCrees.push(compromis.id);
  return { bien, acquereur, compromis };
}

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("ajouterRemunerationAction — garde-fous", () => {
  it("refuse explicitement (throw) sur un compromis annulé", async () => {
    const { compromis } = await creerCompromisDeTest("ANNULE");
    await marquerCompromisAnnule(compromis.id, "2026-08-10", "autre");

    await expect(
      ajouterRemunerationAction(
        formData({ compromisId: compromis.id, montantRemunerationConseiller: "10000" })
      )
    ).rejects.toThrow(/annulé/);
  });

  it("refuse explicitement (throw) sur un compromis en_cours dont le bien est archivé", async () => {
    const { bien, compromis } = await creerCompromisDeTest("EN-COURS-ARCHIVE");
    await archiverBien(bien.id);

    await expect(
      ajouterRemunerationAction(
        formData({ compromisId: compromis.id, montantRemunerationConseiller: "10000" })
      )
    ).rejects.toThrow(/archivé/);

    await expect(getRemunerationParCompromis(compromis.id)).resolves.toBeUndefined();
  });

  it("refuse explicitement (throw) sur un compromis en_cours dont l'acquéreur est archivé", async () => {
    const { acquereur, compromis } = await creerCompromisDeTest("EN-COURS-ACQ-ARCHIVE");
    await archiverAcquereur(acquereur.id);

    await expect(
      ajouterRemunerationAction(
        formData({ compromisId: compromis.id, montantRemunerationConseiller: "10000" })
      )
    ).rejects.toThrow(/archivé/);
  });

  it("accepte l'ajout sur un compromis realise dont le bien est archivé (archivage commercial ≠ clôture du suivi financier, ADR-021)", async () => {
    const { bien, compromis } = await creerCompromisDeTest("REALISE-ARCHIVE");
    await marquerCompromisRealise(compromis.id, "2026-09-01");
    await archiverBien(bien.id);

    await ajouterRemunerationAction(
      formData({ compromisId: compromis.id, montantRemunerationConseiller: "125000.50" })
    ).catch(() => {});

    const r = await getRemunerationParCompromis(compromis.id);
    if (r) idsRemunerationCrees.push(r.id);
    expect(r?.montantRemunerationConseillerCentimes).toBe(12500050);
  });

  it("refuse explicitement (throw) un montant de rémunération invalide", async () => {
    const { compromis } = await creerCompromisDeTest("MONTANT-INVALIDE");

    await expect(
      ajouterRemunerationAction(formData({ compromisId: compromis.id, montantRemunerationConseiller: "0" }))
    ).rejects.toThrow(/rémunération du conseiller/);
  });

  it("refuse explicitement (throw) une rémunération en doublon pour le même compromis", async () => {
    const { compromis } = await creerCompromisDeTest("DOUBLON");
    const premiere = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(premiere.id);

    await expect(
      ajouterRemunerationAction(
        formData({ compromisId: compromis.id, montantRemunerationConseiller: "50000" })
      )
    ).rejects.toThrow(/existe déjà/);
  });
});

describe("modifierRemunerationAction — garde-fous", () => {
  it("refuse explicitement (throw) si la rémunération est déjà encaissée", async () => {
    const { compromis } = await creerCompromisDeTest("MODIF-ENCAISSEE");
    await marquerCompromisRealise(compromis.id, "2026-09-01");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(r.id);
    await marquerRemunerationEncaissee(compromis.id, "2026-09-15");

    await expect(
      modifierRemunerationAction(
        formData({ compromisId: compromis.id, montantRemunerationConseiller: "200000" })
      )
    ).rejects.toThrow(/encaissée/);
  });

  it("refuse explicitement (throw) sur un compromis en_cours dont le bien est archivé", async () => {
    const { bien, compromis } = await creerCompromisDeTest("MODIF-EN-COURS-ARCHIVE");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(r.id);
    await archiverBien(bien.id);

    await expect(
      modifierRemunerationAction(
        formData({ compromisId: compromis.id, montantRemunerationConseiller: "200000" })
      )
    ).rejects.toThrow(/archivé/);
  });

  it("accepte la correction sur un compromis realise dont le bien est archivé", async () => {
    const { bien, compromis } = await creerCompromisDeTest("MODIF-REALISE-ARCHIVE");
    await marquerCompromisRealise(compromis.id, "2026-09-01");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
      montantHonorairesTotalCentimes: 500000,
    });
    idsRemunerationCrees.push(r.id);
    await archiverBien(bien.id);

    await modifierRemunerationAction(
      formData({ compromisId: compromis.id, montantRemunerationConseiller: "150000" })
    ).catch(() => {});

    const apres = await getRemunerationParCompromis(compromis.id);
    expect(apres?.montantRemunerationConseillerCentimes).toBe(15000000);
  });

  it("un champ honoraires laissé vide dans le formulaire repasse la colonne à NULL en base (pas ignorée)", async () => {
    const { compromis } = await creerCompromisDeTest("MODIF-HONORAIRES-VIDE");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
      montantHonorairesTotalCentimes: 500000,
    });
    idsRemunerationCrees.push(r.id);

    await modifierRemunerationAction(
      formData({ compromisId: compromis.id, montantRemunerationConseiller: "100000", montantHonorairesTotal: "" })
    ).catch(() => {});

    const apres = await getRemunerationParCompromis(compromis.id);
    expect(apres?.montantHonorairesTotalCentimes).toBeUndefined();
  });
});

describe("marquerRemunerationEncaisseeAction — garde-fous", () => {
  it("refuse explicitement (throw) sur un compromis en_cours", async () => {
    const { compromis } = await creerCompromisDeTest("ENCAISSE-EN-COURS");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(r.id);

    await expect(
      marquerRemunerationEncaisseeAction(
        formData({ compromisId: compromis.id, dateEncaissementReelle: "2026-09-15" })
      )
    ).rejects.toThrow(/réalisé/);
  });

  it("refuse explicitement (throw) si le compromis realise n'a pas de dateActeReelle (ligne historique simulée)", async () => {
    const { compromis } = await creerCompromisDeTest("ENCAISSE-SANS-DATE-ACTE");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(r.id);
    // Simule une ligne compromis historique : statut posé directement, sans passer par
    // marquerCompromisRealise — donc sans dateActeReelle.
    await getDb().update(compromisTable).set({ statut: "realise" }).where(eq(compromisTable.id, compromis.id));

    await expect(
      marquerRemunerationEncaisseeAction(
        formData({ compromisId: compromis.id, dateEncaissementReelle: "2026-09-15" })
      )
    ).rejects.toThrow(/date réelle de l'acte/);
  });

  it("accepte l'encaissement sur un compromis realise dont le bien est archivé", async () => {
    const { bien, compromis } = await creerCompromisDeTest("ENCAISSE-ARCHIVE");
    await marquerCompromisRealise(compromis.id, "2026-09-01");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(r.id);
    await archiverBien(bien.id);

    await marquerRemunerationEncaisseeAction(
      formData({ compromisId: compromis.id, dateEncaissementReelle: "2026-09-20" })
    ).catch(() => {});

    const apres = await getRemunerationParCompromis(compromis.id);
    expect(apres?.dateEncaissementReelle).toBe("2026-09-20");
  });

  it("refuse explicitement (throw) une deuxième tentative d'encaissement (gel concurrent)", async () => {
    const { compromis } = await creerCompromisDeTest("ENCAISSE-DEUX-FOIS");
    await marquerCompromisRealise(compromis.id, "2026-09-01");
    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(r.id);
    await marquerRemunerationEncaissee(compromis.id, "2026-09-20");

    await expect(
      marquerRemunerationEncaisseeAction(
        formData({ compromisId: compromis.id, dateEncaissementReelle: "2026-10-01" })
      )
    ).rejects.toThrow(/déjà marquée comme encaissée/);
  });
});
