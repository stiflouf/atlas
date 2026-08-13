import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { dossierFiscal: dossierFiscalTable } = await import("@/db/schema");
const { enregistrerHistoriqueAmorcage, chargerCouvertureAnnee } = await import("./historiqueAmorcageRepository");

const DOSSIER_TEST_ID = "test-dossier-historique-amorcage";

afterAll(async () => {
  await getDb().delete(dossierFiscalTable).where(eq(dossierFiscalTable.id, DOSSIER_TEST_ID));
});

describe("historiqueAmorcageRepository — contrat de couverture (point 3)", () => {
  it("prépare un dossier fiscal de test", async () => {
    await getDb().insert(dossierFiscalTable).values({ id: DOSSIER_TEST_ID }).onConflictDoNothing();
  });

  it("absence de ligne pour une année = couverture inconnue, jamais assimilée à 0", async () => {
    const couverture = await chargerCouvertureAnnee(DOSSIER_TEST_ID, 2019);
    expect(couverture).toEqual({ annee: 2019, connu: false });
  });

  it("une ligne à montant 0 est un zéro confirmé explicitement, distinct de l'absence", async () => {
    await enregistrerHistoriqueAmorcage(DOSSIER_TEST_ID, 2024, 0, "2024-12-31");

    const couverture = await chargerCouvertureAnnee(DOSSIER_TEST_ID, 2024);
    expect(couverture).toEqual({
      annee: 2024,
      connu: true,
      montantEncaisseCentimes: 0,
      dateFinCouverture: "2024-12-31",
    });
  });

  it("upsert : une nouvelle saisie pour la même année remplace la précédente", async () => {
    await enregistrerHistoriqueAmorcage(DOSSIER_TEST_ID, 2025, 1000000, "2025-08-31");
    await enregistrerHistoriqueAmorcage(DOSSIER_TEST_ID, 2025, 1500000, "2025-09-30");

    const couverture = await chargerCouvertureAnnee(DOSSIER_TEST_ID, 2025);
    expect(couverture).toEqual({
      annee: 2025,
      connu: true,
      montantEncaisseCentimes: 1500000,
      dateFinCouverture: "2025-09-30",
    });
  });
});
