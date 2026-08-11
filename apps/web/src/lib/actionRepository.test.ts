import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Test d'intégration : exerce la vraie base Postgres locale (pas de mock), car le garde-fou
// vérifié ici (statut + termineLe posés atomiquement) est une propriété de la requête SQL elle-
// même, pas de la logique applicative. Repli sur le même DATABASE_URL par défaut que
// drizzle.config.ts (Postgres local docker-compose de dev) si non défini par l'environnement.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const { actions: actionsTable } = await import("@/db/schema");
const { creerAction, terminerAction, listerActions } = await import("./actionRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(actionsTable).where(eq(actionsTable.id, id));
  }
});

describe("actionRepository (intégration Postgres)", () => {
  it("creerAction() persiste une action a_faire sans termineLe", async () => {
    const action = await creerAction({
      titre: "[test] Action à faire",
      type: "autre",
      priorite: "normale",
    });
    idsCrees.push(action.id);

    expect(action.statut).toBe("a_faire");
    expect(action.termineLe).toBeUndefined();
  });

  it("terminerAction() pose statut=termine et termineLe dans la même écriture", async () => {
    const action = await creerAction({
      titre: "[test] Action à terminer",
      type: "autre",
      priorite: "normale",
    });
    idsCrees.push(action.id);

    await terminerAction(action.id);

    const actions = await listerActions();
    const misAJour = actions.find((a) => a.id === action.id);

    expect(misAJour).toBeDefined();
    expect(misAJour?.statut).toBe("termine");
    expect(misAJour?.termineLe).toBeDefined();
  });

  it("terminerAction() est un no-op silencieux pour un id mocké (non-UUID)", async () => {
    await expect(terminerAction("act-001")).resolves.toBeUndefined();
  });
});
