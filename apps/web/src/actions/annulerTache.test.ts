import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { taches: tachesTable } = await import("@/db/schema");
const { creerTache, getTacheById } = await import("@/lib/tacheRepository");
const { annulerTacheAction } = await import("./annulerTache");

const idsTachesCrees: string[] = [];

afterAll(async () => {
  for (const id of idsTachesCrees) {
    await getDb().delete(tachesTable).where(eq(tachesTable.id, id));
  }
});

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("annulerTacheAction", () => {
  it("refuse un id manquant", async () => {
    await expect(annulerTacheAction(formData({}))).rejects.toThrow(/[Ii]dentifiant/);
  });

  it("pose annuleeLe sur la tâche", async () => {
    const tache = await creerTache({
      titre: "[test] Tâche à annuler via l'action",
      type: "autre",
      priorite: "normale",
      origine: "manuelle",
    });
    idsTachesCrees.push(tache.id);

    await annulerTacheAction(formData({ id: tache.id })).catch(() => {});

    const relue = await getTacheById(tache.id);
    expect(relue?.annuleeLe).toBeDefined();
    expect(relue?.termineeLe).toBeUndefined();
  });
});
