import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { rfrFoyer: rfrFoyerTable } = await import("@/db/schema");
const { enregistrerRfrFoyerAction } = await import("./rfrFoyer");

afterAll(async () => {
  await getDb().delete(rfrFoyerTable).where(eq(rfrFoyerTable.dossierFiscalId, "default"));
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("enregistrerRfrFoyerAction — garde-fous", () => {
  it("refuse explicitement (throw) un nombre de parts invalide", async () => {
    await expect(
      enregistrerRfrFoyerAction(formData({ anneeRfr: "2024", rfrFoyer: "3000000", nombreParts: "0" }))
    ).rejects.toThrow(/parts/);
  });

  it("refuse explicitement (throw) un RFR invalide", async () => {
    await expect(
      enregistrerRfrFoyerAction(formData({ anneeRfr: "2024", rfrFoyer: "abc", nombreParts: "1.5" }))
    ).rejects.toThrow(/RFR/);
  });

  it("convertit 1,5 part en 150 centièmes exacts, sans flottant", async () => {
    await enregistrerRfrFoyerAction(formData({ anneeRfr: "2024", rfrFoyer: "3000000", nombreParts: "1.5" })).catch(
      () => {}
    );

    const [ligne] = await getDb().select().from(rfrFoyerTable).where(eq(rfrFoyerTable.anneeRfr, 2024));
    expect(ligne?.nombrePartsCentiemes).toBe(150);
  });
});
