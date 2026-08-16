import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";

// ADR-047, §14/§25 de l'audit : creerAcquereurAction n'avait jusqu'ici AUCUN test (confirmé par
// recherche exhaustive). Comportement métier ici, session Atlas mockée comme valide — le refus
// anonyme réel est couvert séparément par creerAcquereur.securite.test.ts.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  evenementsMetier,
} = await import("@/db/schema");
const { getClientById } = await import("@/lib/clientRepository");
const { creerAcquereurAction } = await import("./creerAcquereur");

const REFERENCE_TEST = "[test réel] CREER-ACQUEREUR-COMPORTEMENT";

afterAll(async () => {
  const lignes = await getDb().select().from(acquereursTable).where(like(acquereursTable.nom, `%${REFERENCE_TEST}%`));
  const ids = lignes.map((l) => l.id);
  if (ids.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.acquereurId, ids));
    await getDb().delete(compatibilitesBienAcquereurEtat).where(inArray(compatibilitesBienAcquereurEtat.acquereurId, ids));
    await getDb().delete(compatibilitesARessynchroniser).where(inArray(compatibilitesARessynchroniser.acquereurId, ids));
  }
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

describe("creerAcquereurAction — comportement", () => {
  it("crée l'acquéreur avec les champs soumis", async () => {
    await creerAcquereurAction(formulaireValide()).catch(() => {}); // redirect() attendu (NEXT_REDIRECT)

    const [cree] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, REFERENCE_TEST));
    expect(cree).toBeDefined();
    const relu = await getClientById(cree.id);
    expect(relu?.email).toBe("jean.test@example.com");
  });

  it("budget minimum supérieur au budget maximum est refusé", async () => {
    const formData = formulaireValide();
    formData.set("budgetMin", "500000");
    formData.set("budgetMax", "400000");

    await expect(creerAcquereurAction(formData)).rejects.toThrow(/budget minimum/i);
  });
});
