import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// ADR-047, §14/§25 de l'audit : modifierAcquereurAction n'avait jusqu'ici AUCUN test (confirmé par
// recherche exhaustive). Comportement métier ici, session Atlas mockée valide — le refus anonyme
// est déjà garanti exhaustivement par src/actions/gardeSessionAtlas.structurel.test.ts.
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
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { modifierAcquereurAction } = await import("./modifierAcquereur");

const idsAcquereurs: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.acquereurId, idsAcquereurs));
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereurs));
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereurs));
  }
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
});

function formulaireModification(id: string, overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("prenom", "Jean");
  formData.set("nom", "Martin-Modifie");
  formData.set("email", "jean.modifie@example.com");
  formData.set("telephone", "0611111111");
  formData.set("budgetMin", "150000");
  formData.set("budgetMax", "450000");
  formData.set("criteres", "");
  formData.set("stadeProjet", "recherche_active");
  formData.set("notes", "");
  formData.set("datePremiereContact", "2026-01-01");
  for (const [cle, valeur] of Object.entries(overrides)) formData.set(cle, valeur);
  return formData;
}

describe("modifierAcquereurAction — comportement", () => {
  it("modifie les champs de l'acquéreur existant", async () => {
    const acquereur = await creerAcquereur({
      prenom: "Jean",
      nom: "Martin",
      email: "jean.avant@example.com",
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "decouverte",
      notes: "",
      datePremiereContact: "2026-01-01",
    });
    idsAcquereurs.push(acquereur.id);

    await modifierAcquereurAction(formulaireModification(acquereur.id)).catch(() => {}); // redirect() attendu

    const relu = await getClientById(acquereur.id);
    expect(relu?.email).toBe("jean.modifie@example.com");
    expect(relu?.stadeProjet).toBe("recherche_active");
  });

  it("id inexistant -> notFound(), jamais un succès silencieux", async () => {
    const idInexistant = "00000000-0000-0000-0000-000000000000";
    await expect(modifierAcquereurAction(formulaireModification(idInexistant))).rejects.toThrow();
  });
});
