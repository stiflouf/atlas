import { afterAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
import { eq } from "drizzle-orm";

// Garde-fou ADR-033, point 4 : impossible d'activer une règle qui exige un seuil tant qu'aucun
// seuil valide n'est configuré — jamais un repli silencieux vers une valeur par défaut.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { configurationsAutomatisation: configurationsAutomatisationTable } = await import("@/db/schema");
const { basculerAutomatisationAction, definirSeuilAutomatisationAction } = await import("./automatisations");

const REGLE = "inactivite_prospect_vendeur";

afterAll(async () => {
  await getDb()
    .update(configurationsAutomatisationTable)
    .set({ active: false, seuilJoursInactivite: null })
    .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

async function getSeuilActuel(): Promise<number | null> {
  const [ligne] = await getDb()
    .select()
    .from(configurationsAutomatisationTable)
    .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
  return ligne?.seuilJoursInactivite ?? null;
}

describe("basculerAutomatisationAction — garde du seuil obligatoire (inactivite_prospect_vendeur)", () => {
  it("refuse explicitement (throw) d'activer la règle tant qu'aucun seuil n'est configuré", async () => {
    await getDb()
      .update(configurationsAutomatisationTable)
      .set({ active: false, seuilJoursInactivite: null })
      .where(eq(configurationsAutomatisationTable.regleCode, REGLE));

    await expect(
      basculerAutomatisationAction(formData({ regleCode: REGLE, active: "1" }))
    ).rejects.toThrow(/seuil/);

    const [ligne] = await getDb()
      .select()
      .from(configurationsAutomatisationTable)
      .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
    expect(ligne.active).toBe(false);
  });

  it("autorise l'activation une fois un seuil valide configuré", async () => {
    await definirSeuilAutomatisationAction(formData({ regleCode: REGLE, seuilJours: "10" })).catch(() => {});
    expect(await getSeuilActuel()).toBe(10);

    await basculerAutomatisationAction(formData({ regleCode: REGLE, active: "1" })).catch(() => {});
    const [ligne] = await getDb()
      .select()
      .from(configurationsAutomatisationTable)
      .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
    expect(ligne.active).toBe(true);
  });

  it("la désactivation reste toujours possible, seuil ou non", async () => {
    await basculerAutomatisationAction(formData({ regleCode: REGLE, active: "0" })).catch(() => {});
    const [ligne] = await getDb()
      .select()
      .from(configurationsAutomatisationTable)
      .where(eq(configurationsAutomatisationTable.regleCode, REGLE));
    expect(ligne.active).toBe(false);
  });
});

describe("definirSeuilAutomatisationAction — validation", () => {
  it("refuse explicitement (throw) un seuil non entier ou négatif, ne modifie rien", async () => {
    await getDb()
      .update(configurationsAutomatisationTable)
      .set({ seuilJoursInactivite: 5 })
      .where(eq(configurationsAutomatisationTable.regleCode, REGLE));

    await expect(
      definirSeuilAutomatisationAction(formData({ regleCode: REGLE, seuilJours: "0" }))
    ).rejects.toThrow(/entier strictement positif/);
    await expect(
      definirSeuilAutomatisationAction(formData({ regleCode: REGLE, seuilJours: "-3" }))
    ).rejects.toThrow(/entier strictement positif/);
    await expect(
      definirSeuilAutomatisationAction(formData({ regleCode: REGLE, seuilJours: "pas-un-nombre" }))
    ).rejects.toThrow(/entier strictement positif/);

    expect(await getSeuilActuel()).toBe(5);
  });
});
