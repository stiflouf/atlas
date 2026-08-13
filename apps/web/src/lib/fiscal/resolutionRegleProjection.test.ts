import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Code/catégorie dédiés à ce fichier pour ne jamais interférer avec le référentiel réel seedé.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { regleFiscale: regleFiscaleTable } = await import("@/db/schema");
const { insererRegleFiscale } = await import("@/lib/referentielFiscalRepository");
const { resoudreRegleProjection } = await import("./resolutionRegleProjection");

const CATEGORIE_TEST = "test_categorie_resolution_regle_projection";

afterAll(async () => {
  await getDb().delete(regleFiscaleTable).where(eq(regleFiscaleTable.categorieActivite, CATEGORIE_TEST));
});

describe("resoudreRegleProjection — distinction officielle vs hypothèse de reconduction (correction n° 3)", () => {
  it("prépare une règle ouverte (sans fin connue) et une règle explicitement bornée dans le futur", async () => {
    await insererRegleFiscale({
      code: "test_taux_ouvert",
      categorieActivite: CATEGORIE_TEST,
      valeur: 1000,
      unite: "points_base",
      dateDebutValidite: "2026-01-01",
      dateFinValidite: undefined, // dateFinValidite = NULL, "toujours en vigueur à ce jour"
      sourceLibelle: "Test",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
    await insererRegleFiscale({
      code: "test_taux_borne",
      categorieActivite: CATEGORIE_TEST,
      valeur: 2000,
      unite: "points_base",
      dateDebutValidite: "2026-01-01",
      dateFinValidite: "2029-01-01", // publiée explicitement jusqu'en 2028 inclus
      sourceLibelle: "Test",
      sourceUrl: "https://example.invalid/test",
      statutVerification: "verifie_direct",
    });
  });

  it("une règle sans fin connue demandée en 2030 (date future) est une hypothèse, jamais officielle", async () => {
    const resultat = await resoudreRegleProjection("test_taux_ouvert", CATEGORIE_TEST, "2030-06-01");
    expect(resultat.origine).toBe("hypothese_reconduction");
    if (resultat.origine === "hypothese_reconduction") {
      expect(resultat.regleReconduite.code).toBe("test_taux_ouvert");
      expect(resultat.anneeDerniereRegleOfficielle).toBe(2026);
    }
  });

  it("une règle explicitement publiée jusqu'en 2028 est officielle en 2028", async () => {
    const resultat = await resoudreRegleProjection("test_taux_borne", CATEGORIE_TEST, "2028-06-01");
    expect(resultat).toMatchObject({ origine: "officielle" });
    if (resultat.origine === "officielle") expect(resultat.regle.code).toBe("test_taux_borne");
  });

  it("la même règle bornée, demandée après sa fin de validité (2029), n'est plus 'officielle' mais une reconduction de la dernière connue", async () => {
    const resultat = await resoudreRegleProjection("test_taux_borne", CATEGORIE_TEST, "2030-06-01");
    expect(resultat.origine).toBe("hypothese_reconduction");
    if (resultat.origine === "hypothese_reconduction") {
      expect(resultat.regleReconduite.code).toBe("test_taux_borne");
      expect(resultat.anneeDerniereRegleOfficielle).toBe(2026);
    }
  });

  it("une date passée ou présente reste résolue tel quel (aucune notion de reconduction)", async () => {
    const resultat = await resoudreRegleProjection("test_taux_ouvert", CATEGORIE_TEST, "2026-06-01");
    expect(resultat).toMatchObject({ origine: "officielle" });
  });

  it("aucune règle jamais publiée pour ce code retourne indisponible", async () => {
    const resultat = await resoudreRegleProjection("test_taux_jamais_publie", CATEGORIE_TEST, "2030-01-01");
    expect(resultat).toEqual({ origine: "indisponible", code: "test_taux_jamais_publie" });
  });

  it("ne matérialise jamais la reconduction dans regle_fiscale", async () => {
    await resoudreRegleProjection("test_taux_ouvert", CATEGORIE_TEST, "2035-01-01");
    const lignes = await getDb().select().from(regleFiscaleTable).where(eq(regleFiscaleTable.categorieActivite, CATEGORIE_TEST));
    expect(lignes).toHaveLength(2); // toujours les deux règles insérées manuellement ci-dessus, rien de plus
  });
});
