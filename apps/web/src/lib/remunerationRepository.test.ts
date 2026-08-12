import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : la FK remuneration -> compromis (UNIQUE) impose un compromis réel, donc un
// mock ne suffit pas ici. Même stratégie que compromisRepository.test.ts : bien/acquéreur/compromis
// dédiés à ce fichier pour éviter toute course avec d'autres suites d'intégration.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  remuneration: remunerationTable,
} = await import("@/db/schema");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { enregistrerCompromis } = await import("./compromisRepository");
const {
  listerRemunerationsPourBien,
  getRemunerationParCompromis,
  enregistrerRemuneration,
  modifierRemunerationPrevisionnelle,
  marquerRemunerationEncaissee,
} = await import("./remunerationRepository");

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
    reference: `[test réel] REMUNERATION-${suffixe}`,
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
    nom: `[test réel] Rémunération ${suffixe}`,
    email: `test-réel-remuneration-${suffixe}@example.com`,
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

describe("remunerationRepository (intégration Postgres)", () => {
  it("retourne [] pour un bien non-UUID, undefined pour un compromis non-UUID ou inexistant", async () => {
    await expect(listerRemunerationsPourBien("bien-001")).resolves.toEqual([]);
    await expect(getRemunerationParCompromis("compromis-mock")).resolves.toBeUndefined();
    await expect(
      getRemunerationParCompromis("00000000-0000-0000-0000-000000000000")
    ).resolves.toBeUndefined();
  });

  it("enregistrerRemuneration() persiste les centimes exactement, honoraires/date prévue absents restent undefined", async () => {
    const { compromis } = await creerCompromisDeTest("001");

    const r = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 1248736,
    });
    idsRemunerationCrees.push(r.id);

    expect(r.montantRemunerationConseillerCentimes).toBe(1248736);
    expect(r.montantHonorairesTotalCentimes).toBeUndefined();
    expect(r.dateEncaissementPrevue).toBeUndefined();
    expect(r.dateEncaissementReelle).toBeUndefined();
    expect(r.modifieLe).toBeUndefined();

    const relue = await getRemunerationParCompromis(compromis.id);
    expect(relue?.montantRemunerationConseillerCentimes).toBe(1248736);
  });

  it("le CHECK rejette un montant de rémunération du conseiller <= 0", async () => {
    const { compromis } = await creerCompromisDeTest("002");

    await expect(
      enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: 0 })
    ).rejects.toThrow();
  });

  it("le CHECK rejette des honoraires totaux <= 0 quand renseignés", async () => {
    const { compromis } = await creerCompromisDeTest("003");

    await expect(
      enregistrerRemuneration({
        compromisId: compromis.id,
        montantRemunerationConseillerCentimes: 100000,
        montantHonorairesTotalCentimes: 0,
      })
    ).rejects.toThrow();
  });

  it("la contrainte UNIQUE compromisId rejette une deuxième rémunération pour le même compromis", async () => {
    const { compromis } = await creerCompromisDeTest("004");
    const premiere = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(premiere.id);

    await expect(
      enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: 200000 })
    ).rejects.toThrow();
  });

  it("modifierRemunerationPrevisionnelle() remplace complètement les trois champs, y compris en repassant les honoraires à null (pas un patch partiel)", async () => {
    const { compromis } = await creerCompromisDeTest("005");
    const creee = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
      montantHonorairesTotalCentimes: 500000,
      dateEncaissementPrevue: "2026-09-01",
    });
    idsRemunerationCrees.push(creee.id);

    const corrigee = await modifierRemunerationPrevisionnelle(compromis.id, {
      montantRemunerationConseillerCentimes: 150000,
      montantHonorairesTotalCentimes: null,
      dateEncaissementPrevue: null,
    });

    expect(corrigee?.montantRemunerationConseillerCentimes).toBe(150000);
    expect(corrigee?.montantHonorairesTotalCentimes).toBeUndefined();
    expect(corrigee?.dateEncaissementPrevue).toBeUndefined();
    expect(corrigee?.modifieLe).toBeDefined();
  });

  it("modifierRemunerationPrevisionnelle() retourne undefined si la rémunération est déjà encaissée (gel concurrent)", async () => {
    const { compromis } = await creerCompromisDeTest("006");
    const creee = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(creee.id);
    await marquerRemunerationEncaissee(compromis.id, "2026-09-15");

    const resultat = await modifierRemunerationPrevisionnelle(compromis.id, {
      montantRemunerationConseillerCentimes: 999999,
      montantHonorairesTotalCentimes: null,
      dateEncaissementPrevue: null,
    });

    expect(resultat).toBeUndefined();
    const inchangee = await getRemunerationParCompromis(compromis.id);
    expect(inchangee?.montantRemunerationConseillerCentimes).toBe(100000);
  });

  it("marquerRemunerationEncaissee() pose atomiquement dateEncaissementReelle", async () => {
    const { compromis } = await creerCompromisDeTest("007");
    const creee = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(creee.id);

    const encaissee = await marquerRemunerationEncaissee(compromis.id, "2026-09-20");

    expect(encaissee?.dateEncaissementReelle).toBe("2026-09-20");
    expect(encaissee?.montantRemunerationConseillerCentimes).toBe(100000);
  });

  it("marquerRemunerationEncaissee() retourne undefined en second appel (gel concurrent — encaissement déjà posé)", async () => {
    const { compromis } = await creerCompromisDeTest("008");
    const creee = await enregistrerRemuneration({
      compromisId: compromis.id,
      montantRemunerationConseillerCentimes: 100000,
    });
    idsRemunerationCrees.push(creee.id);
    await marquerRemunerationEncaissee(compromis.id, "2026-09-20");

    const deuxieme = await marquerRemunerationEncaissee(compromis.id, "2026-10-01");

    expect(deuxieme).toBeUndefined();
    const inchangee = await getRemunerationParCompromis(compromis.id);
    expect(inchangee?.dateEncaissementReelle).toBe("2026-09-20");
  });

  it("listerRemunerationsPourBien() ne retourne que les lignes du bien demandé", async () => {
    const { bien: bienA, compromis: compromisA } = await creerCompromisDeTest("009-A");
    const { compromis: compromisB } = await creerCompromisDeTest("009-B");
    const rA = await enregistrerRemuneration({
      compromisId: compromisA.id,
      montantRemunerationConseillerCentimes: 111100,
    });
    idsRemunerationCrees.push(rA.id);
    const rB = await enregistrerRemuneration({
      compromisId: compromisB.id,
      montantRemunerationConseillerCentimes: 222200,
    });
    idsRemunerationCrees.push(rB.id);

    const pourBienA = await listerRemunerationsPourBien(bienA.id);

    expect(pourBienA.map((r) => r.id)).toEqual([rA.id]);
  });
});
