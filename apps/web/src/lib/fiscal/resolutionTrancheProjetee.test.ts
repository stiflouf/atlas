import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { dossierFiscal: dossierFiscalTable, regleFiscale: regleFiscaleTable } = await import("@/db/schema");
const { enregistrerProfilFiscal } = await import("@/lib/profilFiscalRepository");
const { insererRegleFiscale } = await import("@/lib/referentielFiscalRepository");
const { resoudreTrancheProjeteeAvecTaux, construireResultatFiscalProjete } = await import("./resolutionTrancheProjetee");

const DOSSIER_TEST_ID = "test-dossier-resolution-tranche-projetee";
const CATEGORIE_TEST = "test_categorie_resolution_tranche_projetee";
const CODE_TEST = "test_taux_resolution_tranche_projetee";

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
  await getDb().delete(regleFiscaleTable).where(eq(regleFiscaleTable.categorieActivite, CATEGORIE_TEST));
});

function resoudreCodeTest(profil: { regimeFiscal: string }) {
  return profil.regimeFiscal === "micro_bnc" ? CODE_TEST : undefined;
}

describe("resoudreTrancheProjeteeAvecTaux — changement de taux en cours d'année projetée (correction n° 4)", () => {
  it("prépare le dossier, le profil et un changement de taux officiel au milieu de 2030", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
    await enregistrerProfilFiscal({
      dossierFiscalId: DOSSIER_TEST_ID,
      dateDebutValidite: "2020-01-01",
      natureActivite: "agent_commercial_immobilier",
      dateDebutActivite: "2020-01-01",
      regimeFiscal: "micro_bnc",
      regimeTva: "franchise",
      periodiciteUrssaf: "mensuelle",
      affiliationRetraite: "ssi_regime_general",
    });
    // Deux règles officielles (dateFinValidite explicite) couvrant chacune une moitié de 2030 — une
    // année future par rapport à "aujourd'hui", pour exercer le chemin resoudreRegleProjection.
    await insererRegleFiscale({
      code: CODE_TEST,
      categorieActivite: CATEGORIE_TEST,
      valeur: 1000, // 10 %
      unite: "points_base",
      dateDebutValidite: "2030-01-01",
      dateFinValidite: "2030-07-01",
      sourceLibelle: "Test",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
    await insererRegleFiscale({
      code: CODE_TEST,
      categorieActivite: CATEGORIE_TEST,
      valeur: 2000, // 20 %
      unite: "points_base",
      dateDebutValidite: "2030-07-01",
      dateFinValidite: "2031-01-01",
      sourceLibelle: "Test",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
  });

  it("applique le taux de sa propre période à chaque tranche projetée, jamais un taux moyen ni le dernier taux au total annuel", async () => {
    const janvier = await resoudreTrancheProjeteeAvecTaux(
      DOSSIER_TEST_ID,
      { montantCentimes: 1000000, date: "2030-01-15" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );
    const aout = await resoudreTrancheProjeteeAvecTaux(
      DOSSIER_TEST_ID,
      { montantCentimes: 1000000, date: "2030-08-15" },
      CATEGORIE_TEST,
      resoudreCodeTest
    );

    expect(janvier).toMatchObject({ ok: true, montantCentimes: 100000 }); // 10 %
    expect(aout).toMatchObject({ ok: true, montantCentimes: 200000 }); // 20 %
    if (janvier.ok) expect(janvier.provenance).toMatchObject({ origine: "officielle" });
    if (aout.ok) expect(aout.provenance).toMatchObject({ origine: "officielle" });

    // Une répartition naïve "12 tranches identiques x dernier taux (20 %)" donnerait 2 400 000 pour
    // l'année ; la somme correcte tranche par tranche (6 mois à 10 %, 6 mois à 20 %) donne 1 800 000.
    const anneeEntiere = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        resoudreTrancheProjeteeAvecTaux(
          DOSSIER_TEST_ID,
          { montantCentimes: 1000000, date: `2030-${String(i + 1).padStart(2, "0")}-15` },
          CATEGORIE_TEST,
          resoudreCodeTest
        )
      )
    );
    const resultat = construireResultatFiscalProjete(anneeEntiere);
    expect(resultat).toMatchObject({ statut: "calcule", valeur: 1800000 });
    expect(resultat).not.toMatchObject({ valeur: 2400000 });
  });

  it("un régime non couvert retourne regime_non_couvert, jamais une approximation", async () => {
    const resultat = await resoudreTrancheProjeteeAvecTaux(
      DOSSIER_TEST_ID,
      { montantCentimes: 1000000, date: "2030-03-01" },
      CATEGORIE_TEST,
      () => undefined
    );
    expect(resultat).toEqual({
      ok: false,
      raison: { type: "regime_non_couvert", regimeFiscal: "micro_bnc", date: "2030-03-01" },
    });
  });
});

describe("construireResultatFiscalProjete — statut calcule/partiel/indisponible", () => {
  it("indisponible quand des tranches existent mais qu'aucune ne résout", () => {
    const resultat = construireResultatFiscalProjete([
      { ok: false, raison: { type: "regle_absente", code: CODE_TEST, date: "2030-01-01" } },
    ]);
    expect(resultat.statut).toBe("indisponible");
  });

  it("calcule à 0 pour une liste de tranches vide", () => {
    expect(construireResultatFiscalProjete([])).toEqual({ statut: "calcule", valeur: 0, provenance: [] });
  });
});
