import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// ADR-047, §35 de l'audit : enregistrerValidationBien n'avait jusqu'ici aucun test, direct ou
// indirect. Fournit le test comportemental direct demandé : un appel anonyme doit échouer AVANT
// toute mutation DB. Séparé de validationRendezVous.test.ts (comportement métier, session mockée
// valide) pour ne jamais mélanger deux stratégies de mock dans un seul fichier.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockRejectedValue(new Error("Non authentifié.")),
}));

const { getDb } = await import("@/db/client");
const { memoireContextuelle } = await import("@/db/schema");
const { enregistrerValidationBien } = await import("./validationRendezVous");

const RDV_MOCK_ID = "rdv-001";
const SOURCE_GOOGLE_CALENDAR = "google_calendar";

afterAll(async () => {
  await getDb()
    .delete(memoireContextuelle)
    .where(and(eq(memoireContextuelle.source, SOURCE_GOOGLE_CALENDAR), eq(memoireContextuelle.identifiantExterne, RDV_MOCK_ID)));
});

describe("enregistrerValidationBien — sécurité (ADR-047)", () => {
  it("anonyme échoue AVANT toute mutation DB — aucune ligne memoire_contextuelle créée/modifiée", async () => {
    await expect(enregistrerValidationBien(RDV_MOCK_ID, "confirme", null)).rejects.toThrow(/non authentifié/i);

    const [ligne] = await getDb()
      .select()
      .from(memoireContextuelle)
      .where(and(eq(memoireContextuelle.source, SOURCE_GOOGLE_CALENDAR), eq(memoireContextuelle.identifiantExterne, RDV_MOCK_ID)));
    expect(ligne).toBeUndefined();
  });
});
