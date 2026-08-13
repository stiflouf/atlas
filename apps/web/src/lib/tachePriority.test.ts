import { describe, expect, it } from "vitest";
import type { Tache } from "@/types/tache";
import { estEnRetard, scoreTache, tachePrioritaire, trierParPriorite, raisonTache } from "./tachePriority";

function tacheTest(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "tache-test",
    titre: "Tâche de test",
    priorite: "normale",
    type: "autre",
    origine: "manuelle",
    creeLe: "2026-08-01",
    ...surcharge,
  };
}

describe("scoreTache", () => {
  it("renvoie -Infinity pour une tâche terminée, quelle que soit sa priorité", () => {
    const tache = tacheTest({ termineeLe: "2026-08-10", priorite: "haute" });
    expect(scoreTache(tache, new Date("2026-08-11"))).toBe(-Infinity);
  });

  it("renvoie -Infinity pour une tâche annulée, quelle que soit sa priorité", () => {
    const tache = tacheTest({ annuleeLe: "2026-08-10", priorite: "haute" });
    expect(scoreTache(tache, new Date("2026-08-11"))).toBe(-Infinity);
  });

  it("majore le score d'une tâche en retard", () => {
    const enRetard = tacheTest({ echeance: "2026-08-01" });
    const aTemps = tacheTest({ echeance: "2026-08-20" });
    const maintenant = new Date("2026-08-11");
    expect(scoreTache(enRetard, maintenant)).toBeGreaterThan(scoreTache(aTemps, maintenant));
  });
});

describe("estEnRetard", () => {
  it("est vrai quand l'échéance est strictement passée", () => {
    expect(estEnRetard(tacheTest({ echeance: "2026-08-01" }), new Date("2026-08-11"))).toBe(true);
  });

  it("est faux sans échéance, quelle que soit la date", () => {
    expect(estEnRetard(tacheTest({ echeance: undefined }), new Date("2026-08-11"))).toBe(false);
  });

  it("est faux quand l'échéance est aujourd'hui ou dans le futur", () => {
    expect(estEnRetard(tacheTest({ echeance: "2026-08-11" }), new Date("2026-08-11"))).toBe(false);
    expect(estEnRetard(tacheTest({ echeance: "2026-08-20" }), new Date("2026-08-11"))).toBe(false);
  });
});

describe("trierParPriorite / tachePrioritaire", () => {
  it("exclut toujours les tâches terminées et annulées, même prioritaires", () => {
    const termineeHaute = tacheTest({ id: "t1", termineeLe: "2026-08-10", priorite: "haute" });
    const annuleeHaute = tacheTest({ id: "t2", annuleeLe: "2026-08-10", priorite: "haute" });
    const aFaireBasse = tacheTest({ id: "t3", priorite: "basse" });
    const maintenant = new Date("2026-08-11");

    const resultat = trierParPriorite([termineeHaute, annuleeHaute, aFaireBasse], maintenant);

    expect(resultat.map((t) => t.id)).toEqual(["t3"]);
    expect(tachePrioritaire([termineeHaute, annuleeHaute], maintenant)).toBeUndefined();
  });

  it("à score égal, la tâche la plus ancienne (creeLe) passe devant", () => {
    const recente = tacheTest({ id: "recente", creeLe: "2026-08-05" });
    const ancienne = tacheTest({ id: "ancienne", creeLe: "2026-07-01" });
    const maintenant = new Date("2026-08-11");

    const resultat = trierParPriorite([recente, ancienne], maintenant);

    expect(resultat.map((t) => t.id)).toEqual(["ancienne", "recente"]);
  });
});

describe("raisonTache", () => {
  it("utilise le contexte quand il est présent", () => {
    expect(raisonTache(tacheTest({ contexte: "Contexte précis" }))).toBe("Contexte précis");
  });

  it("retombe sur le titre quand le contexte est absent", () => {
    expect(raisonTache(tacheTest({ titre: "Titre seul", contexte: undefined }))).toBe("Titre seul");
  });
});
