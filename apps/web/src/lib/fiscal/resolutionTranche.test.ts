import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration dédié au mécanisme de rattachement tranche -> règle (ADR-024). Code et
// catégorie d'activité réservés à ce fichier pour pouvoir simuler un changement de taux en cours
// d'année sans jamais toucher au référentiel réel seedé (0015_seed_referentiel_fiscal_2026.sql).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { dossierFiscal: dossierFiscalTable, regleFiscale: regleFiscaleTable } = await import("@/db/schema");
const { enregistrerProfilFiscal } = await import("@/lib/profilFiscalRepository");
const { insererRegleFiscale } = await import("@/lib/referentielFiscalRepository");
const { resoudreTrancheAvecTaux, construireResultatFiscal } = await import("./resolutionTranche");

const DOSSIER_TEST_ID = "test-dossier-resolution-tranche";
const CATEGORIE_TEST = "test_categorie_resolution_tranche";
const CODE_TEST = "test_taux_resolution_tranche";

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
  await getDb().delete(regleFiscaleTable).where(eq(regleFiscaleTable.categorieActivite, CATEGORIE_TEST));
});

function resoudreCodeTest(profil: { regimeFiscal: string }) {
  return profil.regimeFiscal === "micro_bnc" ? CODE_TEST : undefined;
}

describe("resoudreTrancheAvecTaux — rattachement tranche par tranche, jamais un taux moyen", () => {
  it("prépare le dossier, le profil et deux règles consécutives (changement de taux au 1er juillet)", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_TEST_ID,
      dateDebutValidite: "2019-01-01", // antérieur à la première règle (2020-01-01), pour isoler
      // regle_absente de regime_non_couvert dans le test "aucune règle avant la première période"
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2019-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    await insererRegleFiscale({
      code: CODE_TEST,
      categorieActivite: CATEGORIE_TEST,
      valeur: 1000, // 10 %
      unite: "points_base",
      dateDebutValidite: "2020-01-01",
      dateFinValidite: "2020-07-01",
      sourceLibelle: "Test",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
    await insererRegleFiscale({
      code: CODE_TEST,
      categorieActivite: CATEGORIE_TEST,
      valeur: 2000, // 20 %
      unite: "points_base",
      dateDebutValidite: "2020-07-01",
      dateFinValidite: undefined,
      sourceLibelle: "Test",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
  });

  it("applique le taux de sa propre période à chaque tranche, jamais un taux moyen", async () => {
    const avant = await resoudreTrancheAvecTaux(
      DOSSIER_TEST_ID,
      2020,
      { origine: "remuneration_atlas", montantCentimes: 1000000, date: "2020-03-01" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );
    const apres = await resoudreTrancheAvecTaux(
      DOSSIER_TEST_ID,
      2020,
      { origine: "remuneration_atlas", montantCentimes: 1000000, date: "2020-09-01" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );

    expect(avant).toMatchObject({ ok: true, montantCentimes: 100000 }); // 10 %
    expect(apres).toMatchObject({ ok: true, montantCentimes: 200000 }); // 20 %
    if (avant.ok) expect(avant.provenance.dateDebutValidite).toBe("2020-01-01");
    if (apres.ok) expect(apres.provenance.dateDebutValidite).toBe("2020-07-01");
  });

  it("une tranche d'amorçage chevauchant le changement de taux est non ventilable, jamais estimée", async () => {
    const resultat = await resoudreTrancheAvecTaux(
      DOSSIER_TEST_ID,
      2020,
      { origine: "historique_amorcage", montantCentimes: 5000000, dateDebut: "2020-01-01", dateFin: "2020-12-31" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );
    expect(resultat).toEqual({ ok: false, raison: { type: "amorcage_non_ventilable", annee: 2020, codeRegle: CODE_TEST } });
  });

  it("une tranche d'amorçage entièrement dans une seule période reste calculable", async () => {
    const resultat = await resoudreTrancheAvecTaux(
      DOSSIER_TEST_ID,
      2020,
      { origine: "historique_amorcage", montantCentimes: 1000000, dateDebut: "2020-01-01", dateFin: "2020-05-31" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );
    expect(resultat).toMatchObject({ ok: true, montantCentimes: 100000 });
  });

  it("aucune règle avant la première période : regle_absente, jamais une extrapolation", async () => {
    const resultat = await resoudreTrancheAvecTaux(
      DOSSIER_TEST_ID,
      2019,
      { origine: "remuneration_atlas", montantCentimes: 1000000, date: "2019-06-01" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );
    expect(resultat).toEqual({ ok: false, raison: { type: "regle_absente", code: CODE_TEST, date: "2019-06-01" } });
  });

  it("un régime non couvert par le résolveur de code retourne regime_non_couvert", async () => {
    const resultat = await resoudreTrancheAvecTaux(
      DOSSIER_TEST_ID,
      2020,
      { origine: "remuneration_atlas", montantCentimes: 1000000, date: "2020-03-01" },
      CATEGORIE_TEST,
      () => undefined // simule un profil non couvert, quel que soit le champ testé
    );
    expect(resultat).toEqual({
      ok: false,
      raison: { type: "regime_non_couvert", regimeFiscal: "micro_bnc", date: "2020-03-01" },
    });
  });
});

describe("construireResultatFiscal — statut calcule/partiel/indisponible", () => {
  const assietteComplete = {
    annee: 2020,
    montantConnuCentimes: 1000000,
    origines: [],
    couverture: "complete" as const,
    periodesInconnues: [],
    dateCalcul: "2020-12-31",
  };
  const assiettePartielle = { ...assietteComplete, couverture: "partielle" as const, periodesInconnues: [{ debut: "2020-01-01", fin: "2020-12-31" }] };
  const provenanceTest = {
    code: CODE_TEST,
    categorieActivite: CATEGORIE_TEST,
    dateDebutValidite: "2020-01-01",
    statutVerification: "verifie_direct" as const,
    sourceLibelle: "Test",
    sourceUrl: "https://example.invalid/test",
  };

  it("calcule quand toutes les tranches résolvent et l'assiette est complète", () => {
    const resultat = construireResultatFiscal(assietteComplete, [
      { ok: true, montantCentimes: 1000, provenance: provenanceTest },
    ]);
    expect(resultat).toMatchObject({ statut: "calcule", valeur: 1000 });
  });

  it("jamais calcule sur une assiette partielle, même si toutes les tranches connues résolvent", () => {
    const resultat = construireResultatFiscal(assiettePartielle, [
      { ok: true, montantCentimes: 1000, provenance: provenanceTest },
    ]);
    expect(resultat.statut).toBe("partiel");
    if (resultat.statut === "partiel") {
      expect(resultat.valeurConnue).toBe(1000);
      expect(resultat.raisons).toContainEqual({ type: "assiette_incomplete", periodesInconnues: assiettePartielle.periodesInconnues });
    }
  });

  it("indisponible quand des tranches existent mais qu'aucune ne résout", () => {
    const resultat = construireResultatFiscal(assietteComplete, [
      { ok: false, raison: { type: "regle_absente", code: CODE_TEST, date: "2020-01-01" } },
    ]);
    expect(resultat.statut).toBe("indisponible");
  });

  it("calcule à 0 quand il n'y a aucune tranche et une couverture complète", () => {
    const resultat = construireResultatFiscal({ ...assietteComplete, montantConnuCentimes: 0 }, []);
    expect(resultat).toMatchObject({ statut: "calcule", valeur: 0 });
  });
});
