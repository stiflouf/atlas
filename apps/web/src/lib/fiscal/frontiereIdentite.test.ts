import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// FISCAL_IDENTITY_OWNERSHIP_V1 (ADR-054 §6 bis) — la frontière du domaine fiscal PERSONNEL.
//
// Deux défauts distincts vivaient ici, et ils ne se corrigent pas l'un sans l'autre :
//   - `dossier_fiscal` était un singleton (`id = 'default'`, reader sans paramètre) : deux
//     personnes partageaient un régime micro-BNC et un RFR de FOYER, et l'UPSERT de l'une écrasait
//     la saisie de l'autre ;
//   - `remuneration` n'avait aucun bénéficiaire, et `listerEncaissementsAnnee` ne joignait même pas
//     `biens` : l'assiette agrégeait l'argent de tout le monde, sans même un périmètre workspace.
//
// Rattacher le dossier sans attribuer les honoraires aurait produit pire que l'état de départ : un
// dossier nominativement personnel, nourri du chiffre d'affaires d'autrui. D'où les deux moitiés.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  dossierFiscal: dossierFiscalTable,
  rfrFoyer: rfrFoyerTable,
  historiqueAmorcage: historiqueAmorcageTable,
  profilFiscal: profilFiscalTable,
  remuneration: remunerationTable,
  compromis: compromisTable,
  biens: biensTable,
  acquereurs: acquereursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { obtenirDossierFiscalDeLIdentite } = await import("@/lib/dossierFiscalRepository");
const { enregistrerRfrFoyer, chargerRfrFoyer } = await import("@/lib/rfrFoyerRepository");
const { enregistrerHistoriqueAmorcage, chargerHistoriqueAmorcage } = await import("@/lib/historiqueAmorcageRepository");
const { enregistrerProfilFiscal, chargerProfilFiscalActuel } = await import("@/lib/profilFiscalRepository");
const { listerEncaissementsAnneePourIdentite, listerEncaissementsDepuisPourIdentite, enregistrerRemuneration } =
  await import("@/lib/remunerationRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");

const M = `Zfio${Date.now()}`;
const SUB_A = `${M}-identite-A`;
const SUB_B = `${M}-identite-B`;
const WORKSPACE_A2 = `${M}-ws-a2`;

const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsCompromis: string[] = [];
const idsRemunerations: string[] = [];

beforeAll(async () => {
  await getDb().insert(workspacesTable).values({ id: WORKSPACE_A2, nom: "[test réel] second workspace de A" });
});

afterAll(async () => {
  if (idsRemunerations.length) await getDb().delete(remunerationTable).where(inArray(remunerationTable.id, idsRemunerations));
  if (idsCompromis.length) await getDb().delete(compromisTable).where(inArray(compromisTable.id, idsCompromis));
  if (idsBiens.length) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  await getDb().delete(dossierFiscalTable).where(inArray(dossierFiscalTable.identiteSub, [SUB_A, SUB_B]));
  await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_A2));
});

let compteur = 0;

// Une rémunération encaissée, dans le workspace demandé, au bénéfice de l'identité demandée.
async function unEncaissement(workspaceId: string, beneficiaire: string, montantCentimes: number, date: string) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] FIO-${compteur}-${Date.now()}`,
      titre: `${M} bien ${compteur}`,
      type: "appartement",
      adresse: `${compteur} rue Fiscale`,
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  const acquereur = await creerAcquereur(
    {
      prenom: "Test",
      nom: `${M}Acq${compteur}`,
      email: `${M}.${compteur}@example.test`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 500000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  const compromisCree = await enregistrerCompromis({
    bienId: bien.id,
    acquereurId: acquereur.id,
    prixConvenu: 300000,
    dateSignature: "2026-01-15",
  });
  idsCompromis.push(compromisCree.id);
  await getDb().update(compromisTable).set({ statut: "realise" }).where(eq(compromisTable.id, compromisCree.id));

  const remunerationCreee = await enregistrerRemuneration({
    compromisId: compromisCree.id,
    beneficiaireIdentiteSub: beneficiaire,
    montantRemunerationConseillerCentimes: montantCentimes,
  });
  idsRemunerations.push(remunerationCreee.id);
  await getDb()
    .update(remunerationTable)
    .set({ dateEncaissementReelle: date })
    .where(eq(remunerationTable.id, remunerationCreee.id));
  return remunerationCreee;
}

describe("T1–T3 — un dossier fiscal par personne", () => {
  it("T1/T3 — deux identités obtiennent deux dossiers distincts, chacun le sien", async () => {
    const dossierA = await obtenirDossierFiscalDeLIdentite(SUB_A);
    const dossierB = await obtenirDossierFiscalDeLIdentite(SUB_B);

    expect(dossierA).not.toBe(dossierB);
    // Plus aucun dossier ne s'appelle 'default' : l'id est généré, l'identité est la clé.
    expect(dossierA).not.toBe("default");
    expect(dossierB).not.toBe("default");

    // T2 — A ne peut pas atteindre le dossier de B : il n'existe aucun chemin qui le permette,
    // la seule porte d'entrée exige une identité et rend celui de cette identité.
    expect(await obtenirDossierFiscalDeLIdentite(SUB_A)).toBe(dossierA);
  });

  it("appelé deux fois pour la même identité, le dossier est le MÊME (une ligne par personne)", async () => {
    const premier = await obtenirDossierFiscalDeLIdentite(SUB_A);
    const second = await obtenirDossierFiscalDeLIdentite(SUB_A);
    expect(second).toBe(premier);

    const lignes = await getDb().select().from(dossierFiscalTable).where(eq(dossierFiscalTable.identiteSub, SUB_A));
    expect(lignes).toHaveLength(1);
  });
});

describe("T4 — les trois tables filles restent isolées par leur dossier parent", () => {
  it("RFR, amorçage et profil de A sont invisibles depuis le dossier de B", async () => {
    const dossierA = await obtenirDossierFiscalDeLIdentite(SUB_A);
    const dossierB = await obtenirDossierFiscalDeLIdentite(SUB_B);

    await enregistrerRfrFoyer(dossierA, 2024, 4_500_000, 200);
    await enregistrerRfrFoyer(dossierB, 2024, 9_900_000, 100);
    await enregistrerHistoriqueAmorcage(dossierA, 2025, 1_000_000, "2025-12-31");
    await enregistrerHistoriqueAmorcage(dossierB, 2025, 7_000_000, "2025-12-31");

    const rfrA = await chargerRfrFoyer(dossierA);
    const rfrB = await chargerRfrFoyer(dossierB);
    expect(rfrA.find((l) => l.anneeRfr === 2024)?.rfrFoyerCentimes).toBe(4_500_000);
    // L'UPSERT de B n'a pas écrasé celui de A : c'était exactement le défaut du singleton.
    expect(rfrB.find((l) => l.anneeRfr === 2024)?.rfrFoyerCentimes).toBe(9_900_000);

    const amorcageA = await chargerHistoriqueAmorcage(dossierA);
    expect(amorcageA.find((l) => l.annee === 2025)?.montantEncaisseCentimes).toBe(1_000_000);
    expect((await chargerHistoriqueAmorcage(dossierB)).find((l) => l.annee === 2025)?.montantEncaisseCentimes).toBe(
      7_000_000
    );
  });

  it("le profil fiscal de A n'est jamais rendu pour le dossier de B", async () => {
    const dossierA = await obtenirDossierFiscalDeLIdentite(SUB_A);
    const dossierB = await obtenirDossierFiscalDeLIdentite(SUB_B);

    await enregistrerProfilFiscal({
      dossierFiscalId: dossierA,
      dateDebutValidite: "2026-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2024-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "trimestrielle",
      affiliationRetraite: "ssi_regime_general",
    });

    expect((await chargerProfilFiscalActuel(dossierA))?.regimeFiscal).toBe("micro_bnc");
    expect(await chargerProfilFiscalActuel(dossierB)).toBeUndefined();
  });
});

describe("T5/T7/T8 — l'assiette ne contient que les honoraires dont la personne est bénéficiaire", () => {
  it("T5 + T7 — deux bénéficiaires DANS LE MÊME WORKSPACE restent séparés", async () => {
    // Le cas que le workspace ne pouvait pas trancher : un seul périmètre, deux personnes.
    await unEncaissement(WORKSPACE_TEST, SUB_A, 300_000, "2026-04-01");
    await unEncaissement(WORKSPACE_TEST, SUB_B, 800_000, "2026-04-02");

    const assietteA = await listerEncaissementsAnneePourIdentite(SUB_A, 2026);
    const assietteB = await listerEncaissementsAnneePourIdentite(SUB_B, 2026);

    expect(assietteA.map((e) => e.montantCentimes)).toEqual([300_000]);
    expect(assietteB.map((e) => e.montantCentimes)).toEqual([800_000]);
    // T8 — les totaux sont indépendants, aucun revenu partagé.
    expect(assietteA.some((e) => e.montantCentimes === 800_000)).toBe(false);
  });

  it("T6 — une identité présente dans DEUX workspaces a UNE assiette, sans double compte", async () => {
    await unEncaissement(WORKSPACE_A2, SUB_A, 500_000, "2026-05-01");

    const assietteA = await listerEncaissementsAnneePourIdentite(SUB_A, 2026);
    const montants = assietteA.map((e) => e.montantCentimes).sort((x, y) => x - y);

    // Les deux workspaces de A sont agrégés — l'assiette suit la PERSONNE, pas le périmètre —
    // et chaque encaissement n'apparaît qu'une fois.
    expect(montants).toEqual([300_000, 500_000]);
    expect(await listerEncaissementsAnneePourIdentite(SUB_B, 2026)).toHaveLength(1);
  });

  it("l'historique depuis une date suit la même frontière", async () => {
    const depuisA = await listerEncaissementsDepuisPourIdentite(SUB_A, "2026-01-01");
    expect(depuisA.map((e) => e.montantCentimes).sort((x, y) => x - y)).toEqual([300_000, 500_000]);
    expect(await listerEncaissementsDepuisPourIdentite(SUB_B, "2026-01-01")).toHaveLength(1);
  });

  it("une identité sans aucun encaissement a une assiette vide, même si d'autres en ont", async () => {
    expect(await listerEncaissementsAnneePourIdentite(`${M}-inconnue`, 2026)).toEqual([]);
  });
});

describe("T9 — l'identité fiscale est dérivée du serveur", () => {
  it("le repository n'expose aucun chemin permettant d'atteindre un dossier sans identité", async () => {
    const module = await import("@/lib/dossierFiscalRepository");
    const exports = Object.keys(module);
    // Une seule porte d'entrée, et elle exige l'identité (longueur de signature = 1 paramètre).
    expect(exports).toEqual(["obtenirDossierFiscalDeLIdentite"]);
    expect(module.obtenirDossierFiscalDeLIdentite.length).toBe(1);
  });
});
