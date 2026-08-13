import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration — dossier fiscal + bien/acquéreur/compromis dédiés à ce fichier, même stratégie
// que remunerationRepository.test.ts. Toutes les fixtures utilisent une année passée fixe (2020)
// pour rester déterministes (finVisible = 31/12 quel que soit le jour d'exécution des tests).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  dossierFiscal: dossierFiscalTable,
  biens: biensTable,
  acquereurs: acquereursTable,
  compromis: compromisTable,
  remuneration: remunerationTable,
} = await import("@/db/schema");
const { enregistrerProfilFiscal } = await import("@/lib/profilFiscalRepository");
const { enregistrerHistoriqueAmorcage } = await import("@/lib/historiqueAmorcageRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { enregistrerCompromis } = await import("@/lib/compromisRepository");
const { enregistrerRemuneration, marquerRemunerationEncaissee } = await import("@/lib/remunerationRepository");
const { calculerAssietteAnnuelle } = await import("./assietteAnnuelle");

const DOSSIER_TEST_ID = "test-dossier-assiette-annuelle";
const idsCompromisCrees: string[] = [];
const idsBiensCrees: string[] = [];
const idsAcquereursCrees: string[] = [];

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
  for (const id of idsCompromisCrees) await getDb().delete(compromisTable).where(eq(compromisTable.id, id));
  for (const id of idsBiensCrees) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

async function preparerProfil(dateDebutActivite: string) {
  await enregistrerProfilFiscal({
    dossierFiscalId: DOSSIER_TEST_ID,
    dateDebutValidite: dateDebutActivite,
    natureActivite: "agent_commercial_immobilier",
    dateDebutActivite,
    regimeFiscal: "micro_bnc",
    regimeTva: "franchise",
    periodiciteUrssaf: "mensuelle",
    affiliationRetraite: "ssi_regime_general",
  });
}

async function creerEncaissement(suffixe: string, montantCentimes: number, dateEncaissementReelle: string) {
  const bien = await creerBien({
    reference: `[test réel] ASSIETTE-${suffixe}`,
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2020-01-01",
    caracteristiques: [],
    description: "",
  });
  idsBiensCrees.push(bien.id);
  const acquereur = await creerAcquereur({
    prenom: "Test",
    nom: `[test réel] Assiette ${suffixe}`,
    email: `test-réel-assiette-${suffixe}@example.com`,
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "compromis",
    notes: "",
    datePremiereContact: "2020-01-01",
  });
  idsAcquereursCrees.push(acquereur.id);
  const compromis = await enregistrerCompromis({
    bienId: bien.id,
    acquereurId: acquereur.id,
    prixConvenu: 300000,
    dateSignature: dateEncaissementReelle,
  });
  idsCompromisCrees.push(compromis.id);
  await getDb().update(compromisTable).set({ statut: "realise" }).where(eq(compromisTable.id, compromis.id));
  await enregistrerRemuneration({ compromisId: compromis.id, montantRemunerationConseillerCentimes: montantCentimes });
  await marquerRemunerationEncaissee(compromis.id, dateEncaissementReelle);
}

describe("calculerAssietteAnnuelle — correction obligatoire n° 1 (aucune déduction depuis le premier encaissement Atlas)", () => {
  it("prépare le dossier fiscal de test", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
    await preparerProfil("2019-01-01");
  });

  it("aucune ligne d'amorçage, aucun encaissement : montant 0, couverture partielle sur toute l'année", async () => {
    const assiette = await calculerAssietteAnnuelle(DOSSIER_TEST_ID, 2020);
    expect(assiette.montantConnuCentimes).toBe(0);
    expect(assiette.origines).toEqual([]);
    expect(assiette.couverture).toBe("partielle");
    expect(assiette.periodesInconnues).toEqual([{ debut: "2020-01-01", fin: "2020-12-31" }]);
  });

  it("aucune ligne d'amorçage mais un encaissement Atlas connu : le montant compte, la couverture reste partielle", async () => {
    await creerEncaissement("001", 500000, "2020-09-15");

    const assiette = await calculerAssietteAnnuelle(DOSSIER_TEST_ID, 2020);

    // Correction n° 1 : le premier encaissement Atlas n'est jamais un début de couverture.
    expect(assiette.montantConnuCentimes).toBe(500000);
    expect(assiette.origines).toEqual([
      {
        source: "remuneration_atlas",
        montantCentimes: 500000,
        nombreEncaissements: 1,
        premierEncaissement: "2020-09-15",
        dernierEncaissement: "2020-09-15",
      },
    ]);
    expect(assiette.couverture).toBe("partielle");
    // La période inconnue couvre toute l'année visible, y compris la période où l'encaissement
    // connu existe — ce n'est pas "aucune donnée", c'est "aucune garantie d'exhaustivité".
    expect(assiette.periodesInconnues).toEqual([{ debut: "2020-01-01", fin: "2020-12-31" }]);
  });

  it("une ligne d'amorçage à 0 confirmé, sans encaissement après : couverture complète, montant 0", async () => {
    await enregistrerHistoriqueAmorcage(DOSSIER_TEST_ID, 2021, 0, "2021-08-31");

    const assiette = await calculerAssietteAnnuelle(DOSSIER_TEST_ID, 2021);
    expect(assiette.montantConnuCentimes).toBe(0);
    expect(assiette.couverture).toBe("complete");
    expect(assiette.periodesInconnues).toEqual([]);
    expect(assiette.origines).toEqual([
      { source: "historique_amorcage", montantCentimes: 0, jusquAuInclus: "2021-08-31" },
    ]);
  });

  it("amorçage + encaissements après la couverture : sommés, jamais de double comptage", async () => {
    await enregistrerHistoriqueAmorcage(DOSSIER_TEST_ID, 2022, 1000000, "2022-06-30");
    // Encaissement AVANT dateFinCouverture : ne doit jamais s'ajouter à l'amorçage (déjà inclus).
    await creerEncaissement("002", 200000, "2022-03-01");
    // Encaissement APRÈS dateFinCouverture : compté séparément.
    await creerEncaissement("003", 300000, "2022-09-01");

    const assiette = await calculerAssietteAnnuelle(DOSSIER_TEST_ID, 2022);
    expect(assiette.couverture).toBe("complete");
    expect(assiette.periodesInconnues).toEqual([]);
    expect(assiette.montantConnuCentimes).toBe(1300000); // 1 000 000 (amorçage) + 300 000 (après), jamais + 200 000
    const origineAtlas = assiette.origines.find((o) => o.source === "remuneration_atlas");
    expect(origineAtlas).toMatchObject({ montantCentimes: 300000, nombreEncaissements: 1 });
  });

  it("dateDebutActivite en cours d'année borne le début de la période inconnue", async () => {
    await preparerProfil("2020-01-01"); // instantané supplémentaire, dateDebutValidite antérieure
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_TEST_ID,
      dateDebutValidite: "2023-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2023-05-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });

    const assiette = await calculerAssietteAnnuelle(DOSSIER_TEST_ID, 2023);
    expect(assiette.periodesInconnues).toEqual([{ debut: "2023-05-01", fin: "2023-12-31" }]);
  });
});
