import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

// Test d'intégration (résolution + insertion en base) + tests unitaires purs (chevauchement) —
// ADR-023, point 5. Code/catégorie dédiés à ce fichier pour ne jamais interférer avec le
// référentiel réel seedé en migration (0015_seed_referentiel_fiscal_2026.sql).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { regleFiscale: regleFiscaleTable } = await import("@/db/schema");
const { intervallesSeChevauchent, insererRegleFiscale, resoudreRegle, listerHistoriqueRegle } = await import(
  "./referentielFiscalRepository"
);

const CATEGORIE_TEST = "test_categorie_referentiel";

afterAll(async () => {
  await getDb().delete(regleFiscaleTable).where(eq(regleFiscaleTable.categorieActivite, CATEGORIE_TEST));
});

function regle(code: string, dateDebutValidite: string, dateFinValidite: string | undefined, valeur: number) {
  return {
    code,
    categorieActivite: CATEGORIE_TEST,
    valeur,
    unite: "centimes" as const,
    dateDebutValidite,
    dateFinValidite,
    sourceLibelle: "Test",
    sourceUrl: "https://example.invalid/test",
    statutVerification: "verifie_direct" as const,
  };
}

describe("intervallesSeChevauchent — convention [début, fin[", () => {
  it("deux intervalles contigus (fin de l'un = début de l'autre) ne se chevauchent pas", () => {
    expect(intervallesSeChevauchent("2026-01-01", "2027-01-01", "2027-01-01", "2028-01-01")).toBe(false);
  });

  it("deux intervalles qui se recoupent réellement se chevauchent", () => {
    expect(intervallesSeChevauchent("2026-01-01", "2027-06-01", "2027-01-01", "2028-01-01")).toBe(true);
  });

  it("un intervalle sans fin connue (undefined = +infini) chevauche tout ce qui commence après son début", () => {
    expect(intervallesSeChevauchent("2026-01-01", undefined, "2030-01-01", "2031-01-01")).toBe(true);
  });

  it("deux intervalles disjoints ne se chevauchent pas", () => {
    expect(intervallesSeChevauchent("2020-01-01", "2021-01-01", "2026-01-01", "2027-01-01")).toBe(false);
  });
});

describe("insererRegleFiscale — rejet des chevauchements", () => {
  it("accepte deux règles contiguës pour le même code/catégorie", async () => {
    await insererRegleFiscale(regle("test_seuil_contigu", "2026-01-01", "2027-01-01", 100));
    await insererRegleFiscale(regle("test_seuil_contigu", "2027-01-01", "2028-01-01", 200));

    const historique = await listerHistoriqueRegle("test_seuil_contigu", CATEGORIE_TEST);
    expect(historique.map((r) => r.valeur)).toEqual([100, 200]);
  });

  it("rejette explicitement (throw) une règle qui chevauche une règle existante", async () => {
    await insererRegleFiscale(regle("test_seuil_chevauche", "2026-01-01", "2027-01-01", 100));

    await expect(insererRegleFiscale(regle("test_seuil_chevauche", "2026-06-01", "2027-06-01", 999))).rejects.toThrow(
      /Chevauchement/
    );
  });

  it("rejette une règle à fin inconnue qui chevauche une règle future déjà existante", async () => {
    await insererRegleFiscale(regle("test_seuil_futur", "2030-01-01", "2031-01-01", 100));

    await expect(insererRegleFiscale(regle("test_seuil_futur", "2026-01-01", undefined, 999))).rejects.toThrow(
      /Chevauchement/
    );
  });
});

describe("resoudreRegle — résolution aux bornes", () => {
  it("résout la bonne règle strictement à l'intérieur de sa période", async () => {
    await insererRegleFiscale(regle("test_seuil_bornes", "2026-01-01", "2027-01-01", 111));
    await insererRegleFiscale(regle("test_seuil_bornes", "2027-01-01", "2028-01-01", 222));

    const resultat = await resoudreRegle("test_seuil_bornes", CATEGORIE_TEST, "2026-06-15");
    expect(resultat?.valeur).toBe(111);
  });

  it("à la date exacte de la borne de fin (exclusive), résout la règle suivante", async () => {
    const resultat = await resoudreRegle("test_seuil_bornes", CATEGORIE_TEST, "2027-01-01");
    expect(resultat?.valeur).toBe(222);
  });

  it("à la date exacte de la borne de début, résout cette règle", async () => {
    const resultat = await resoudreRegle("test_seuil_bornes", CATEGORIE_TEST, "2026-01-01");
    expect(resultat?.valeur).toBe(111);
  });

  it("retourne undefined si aucune règle ne couvre la date demandée (ni défaut, ni extrapolation)", async () => {
    const resultat = await resoudreRegle("test_seuil_bornes", CATEGORIE_TEST, "2025-12-31");
    expect(resultat).toBeUndefined();
  });

  it("retourne toujours statutVerification, jamais masqué", async () => {
    await insererRegleFiscale({ ...regle("test_seuil_statut", "2026-01-01", undefined, 1), statutVerification: "a_confirmer" });
    const resultat = await resoudreRegle("test_seuil_statut", CATEGORIE_TEST, "2026-06-01");
    expect(resultat?.statutVerification).toBe("a_confirmer");
  });
});
