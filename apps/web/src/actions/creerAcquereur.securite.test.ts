import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// ADR-047, §14/§25/§26 de l'audit : creerAcquereurAction n'avait jusqu'ici AUCUN test, direct ou
// indirect (confirmé par recherche exhaustive). Fournit le test comportemental direct demandé par
// le brief : un appel anonyme doit échouer AVANT toute mutation DB. Séparé de creerAcquereur.test.ts
// (comportement métier, session mockée valide) pour ne jamais mélanger vi.mock hoisté et vi.doMock.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockRejectedValue(new Error("Non authentifié.")),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
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
    await expect(creerAcquereurAction(ETAT_FORMULAIRE_INITIAL, formulaireValide())).rejects.toThrow(/non authentifié/i);

    const lignes = await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, REFERENCE_TEST));
    expect(lignes).toHaveLength(0);
  });
});
