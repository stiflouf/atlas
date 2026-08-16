import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";

// ADR-047, §14/§25/§26 de l'audit : creerAcquereurAction n'avait jusqu'ici AUCUN test, direct ou
// indirect (confirmé par recherche exhaustive). Fournit le test comportemental direct demandé par
// le brief : un appel anonyme doit échouer AVANT toute mutation DB. Séparé de creerAcquereur.test.ts
// (comportement métier, session mockée valide) pour ne jamais mélanger vi.mock hoisté et vi.doMock.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockRejectedValue(new Error("Non authentifié.")),
}));

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable } = await import("@/db/schema");
const { creerAcquereurAction } = await import("./creerAcquereur");

const REFERENCE_TEST = "[test réel] CREER-ACQUEREUR-SECURITE";

afterAll(async () => {
  await getDb().delete(acquereursTable).where(like(acquereursTable.nom, `%${REFERENCE_TEST}%`));
});

function formulaireValide(): FormData {
  const formData = new FormData();
  formData.set("prenom", "Jean");
  formData.set("nom", REFERENCE_TEST);
  formData.set("email", "jean.test@example.com");
  formData.set("telephone", "0600000000");
  formData.set("budgetMin", "100000");
  formData.set("budgetMax", "400000");
  formData.set("criteres", "");
  formData.set("stadeProjet", "decouverte");
  formData.set("notes", "");
  formData.set("datePremiereContact", "2026-01-01");
  return formData;
}

describe("creerAcquereurAction — sécurité (ADR-047)", () => {
  it("anonyme échoue AVANT toute mutation DB — zéro ligne créée", async () => {
    await expect(creerAcquereurAction(formulaireValide())).rejects.toThrow(/non authentifié/i);

    const lignes = await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, REFERENCE_TEST));
    expect(lignes).toHaveLength(0);
  });
});
