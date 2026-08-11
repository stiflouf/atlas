import { describe, expect, it } from "vitest";
import type { ActionMetier } from "@/types/action";
import { actionPrioritaire, scoreAction, trierParPriorite } from "./actionPriority";

function actionTest(surcharge: Partial<ActionMetier> = {}): ActionMetier {
  return {
    id: "action-test",
    titre: "Action de test",
    statut: "a_faire",
    priorite: "normale",
    type: "autre",
    creeLe: "2026-08-01",
    ...surcharge,
  };
}

describe("scoreAction", () => {
  it("renvoie -Infinity pour une action terminée, quelle que soit sa priorité", () => {
    const action = actionTest({ statut: "termine", priorite: "haute" });
    expect(scoreAction(action, new Date("2026-08-11"))).toBe(-Infinity);
  });

  it("majore le score d'une action en retard", () => {
    const enRetard = actionTest({ echeance: "2026-08-01" });
    const aTemps = actionTest({ echeance: "2026-08-20" });
    const maintenant = new Date("2026-08-11");
    expect(scoreAction(enRetard, maintenant)).toBeGreaterThan(scoreAction(aTemps, maintenant));
  });
});

describe("trierParPriorite / actionPrioritaire", () => {
  it("exclut toujours les actions terminées, même prioritaires", () => {
    const termineeHaute = actionTest({ id: "a1", statut: "termine", priorite: "haute" });
    const aFaireBasse = actionTest({ id: "a2", statut: "a_faire", priorite: "basse" });
    const maintenant = new Date("2026-08-11");

    const resultat = trierParPriorite([termineeHaute, aFaireBasse], maintenant);

    expect(resultat.map((a) => a.id)).toEqual(["a2"]);
    expect(actionPrioritaire([termineeHaute], maintenant)).toBeUndefined();
  });
});
