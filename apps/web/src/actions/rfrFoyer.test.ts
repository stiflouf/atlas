import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));
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
