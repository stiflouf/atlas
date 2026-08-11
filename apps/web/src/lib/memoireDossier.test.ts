import { describe, expect, it } from "vitest";
import type { ActionMetier } from "@/types/action";
import { selectionnerActionsEnCours, selectionnerHistoriqueRecent } from "./memoireDossier";

function actionTest(surcharge: Partial<ActionMetier> = {}): ActionMetier {
  return {
    id: "action-test",
    titre: "Action de test",
    statut: "a_faire",
    priorite: "normale",
    type: "autre",
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("selectionnerActionsEnCours", () => {
  const maintenant = new Date("2026-08-11T12:00:00.000Z");

  it("fusionne bien et acquéreur en taguant l'origine", () => {
    const bien = [actionTest({ id: "b1" })];
    const acquereur = [actionTest({ id: "a1" })];

    const resultat = selectionnerActionsEnCours(bien, acquereur, maintenant);

    expect(resultat.map((a) => [a.id, a.origine])).toEqual(
      expect.arrayContaining([
        ["b1", "bien"],
        ["a1", "acquereur"],
      ])
    );
  });

  it("exclut les actions terminées", () => {
    const bien = [actionTest({ id: "b1", statut: "termine", termineLe: "2026-08-05T00:00:00.000Z" })];
    expect(selectionnerActionsEnCours(bien, [], maintenant)).toEqual([]);
  });

  it("trie par scoreAction décroissant et plafonne au maximum demandé", () => {
    const bien = [
      actionTest({ id: "basse", priorite: "basse" }),
      actionTest({ id: "haute", priorite: "haute" }),
      actionTest({ id: "normale", priorite: "normale" }),
    ];

    const resultat = selectionnerActionsEnCours(bien, [], maintenant, 2);

    expect(resultat.map((a) => a.id)).toEqual(["haute", "normale"]);
  });
});

describe("selectionnerHistoriqueRecent", () => {
  it("ne retient que les actions terminées, jamais les créations", () => {
    const actions = [actionTest({ id: "ouverte", titre: "Ouverte" })];
    expect(selectionnerHistoriqueRecent(actions)).toEqual([]);
  });

  it("produit « Action terminée : {titre} » daté par termineLe", () => {
    const actions = [
      actionTest({ id: "t1", titre: "Envoyer les diagnostics", statut: "termine", termineLe: "2026-08-05T14:00:00.000Z" }),
    ];
    expect(selectionnerHistoriqueRecent(actions)).toEqual([
      { date: "2026-08-05T14:00:00.000Z", texte: "Action terminée : Envoyer les diagnostics" },
    ]);
  });

  it("trie par date décroissante et plafonne au maximum demandé", () => {
    const actions = [
      actionTest({ id: "t1", titre: "Ancienne", statut: "termine", termineLe: "2026-08-01T00:00:00.000Z" }),
      actionTest({ id: "t2", titre: "Récente", statut: "termine", termineLe: "2026-08-10T00:00:00.000Z" }),
      actionTest({ id: "t3", titre: "Intermédiaire", statut: "termine", termineLe: "2026-08-05T00:00:00.000Z" }),
    ];

    const resultat = selectionnerHistoriqueRecent(actions, 2);

    expect(resultat.map((e) => e.texte)).toEqual(["Action terminée : Récente", "Action terminée : Intermédiaire"]);
  });
});
