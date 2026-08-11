import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale (pas de mock), même principe que
// actionRepository.test.ts. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts si
// non défini par l'environnement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable } = await import("@/db/schema");
const { creerAcquereur, modifierAcquereur } = await import("./clientRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  }
});

function acquereurTest(surcharge: Partial<Parameters<typeof creerAcquereur>[0]> = {}) {
  return {
    prenom: "Test",
    nom: "[test réel] Acquéreur",
    email: "test-réel@example.com",
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "decouverte" as const,
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  };
}

describe("clientRepository (intégration Postgres)", () => {
  it("modifierAcquereur() retourne undefined pour un id non-UUID (acquéreur mocké)", async () => {
    await expect(modifierAcquereur("client-001", acquereurTest())).resolves.toBeUndefined();
  });

  it("modifierAcquereur() retourne undefined pour un UUID inexistant", async () => {
    await expect(
      modifierAcquereur("00000000-0000-0000-0000-000000000000", acquereurTest())
    ).resolves.toBeUndefined();
  });

  it("modifierAcquereur() met à jour les champs et rafraîchit modifieLe", async () => {
    const cree = await creerAcquereur(acquereurTest());
    idsCrees.push(cree.id);

    const [ligneAvant] = await getDb()
      .select()
      .from(acquereursTable)
      .where(eq(acquereursTable.id, cree.id));
    const modifieLeAvant = ligneAvant.modifieLe.getTime();

    await new Promise((r) => setTimeout(r, 10));

    const modifie = await modifierAcquereur(
      cree.id,
      acquereurTest({ prenom: "Prénom modifié", necessiteParking: true })
    );

    expect(modifie).toBeDefined();
    expect(modifie?.prenom).toBe("Prénom modifié");
    expect(modifie?.necessiteParking).toBe(true);

    const [ligneApres] = await getDb()
      .select()
      .from(acquereursTable)
      .where(eq(acquereursTable.id, cree.id));
    expect(ligneApres.modifieLe.getTime()).toBeGreaterThan(modifieLeAvant);
  });

  it("modifierAcquereur() préserve NULL (jamais false) pour un champ tri-état laissé inconnu", async () => {
    const cree = await creerAcquereur(acquereurTest());
    idsCrees.push(cree.id);

    const modifie = await modifierAcquereur(cree.id, acquereurTest());

    expect(modifie?.accessibiliteRequise).toBeUndefined();
    expect(modifie?.necessiteParking).toBeUndefined();
    expect(modifie?.necessiteExterieur).toBeUndefined();
  });
});
