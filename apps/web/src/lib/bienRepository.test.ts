import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale (pas de mock), même principe que
// actionRepository.test.ts. Repli sur le même DATABASE_URL par défaut que drizzle.config.ts si
// non défini par l'environnement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { biens: biensTable } = await import("@/db/schema");
const { creerBien, modifierBien } = await import("./bienRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(biensTable).where(eq(biensTable.id, id));
  }
});

function bienTest(surcharge: Partial<Parameters<typeof creerBien>[0]> = {}) {
  return {
    reference: "[test réel] TEST-001",
    titre: "Bien de test",
    type: "appartement" as const,
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif" as const,
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

describe("bienRepository (intégration Postgres)", () => {
  it("modifierBien() retourne undefined pour un id non-UUID (bien mocké)", async () => {
    await expect(modifierBien("bien-001", bienTest())).resolves.toBeUndefined();
  });

  it("modifierBien() retourne undefined pour un UUID inexistant", async () => {
    await expect(
      modifierBien("00000000-0000-0000-0000-000000000000", bienTest())
    ).resolves.toBeUndefined();
  });

  it("modifierBien() met à jour les champs et rafraîchit modifieLe", async () => {
    const cree = await creerBien(bienTest());
    idsCrees.push(cree.id);

    const [ligneAvant] = await getDb().select().from(biensTable).where(eq(biensTable.id, cree.id));
    const modifieLeAvant = ligneAvant.modifieLe.getTime();

    await new Promise((r) => setTimeout(r, 10));

    const modifie = await modifierBien(cree.id, bienTest({ titre: "Titre modifié", ascenseur: true }));

    expect(modifie).toBeDefined();
    expect(modifie?.titre).toBe("Titre modifié");
    expect(modifie?.ascenseur).toBe(true);

    const [ligneApres] = await getDb().select().from(biensTable).where(eq(biensTable.id, cree.id));
    expect(ligneApres.modifieLe.getTime()).toBeGreaterThan(modifieLeAvant);
  });

  it("modifierBien() préserve NULL (jamais false) pour un champ tri-état laissé inconnu", async () => {
    const cree = await creerBien(bienTest());
    idsCrees.push(cree.id);

    const modifie = await modifierBien(cree.id, bienTest());

    expect(modifie?.ascenseur).toBeUndefined();
    expect(modifie?.parking).toBeUndefined();
  });
});
