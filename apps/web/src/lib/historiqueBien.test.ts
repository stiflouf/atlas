import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { ActionMetier } from "@/types/action";
import { deriverHistoriqueBien } from "./historiqueBien";

function bienTest(surcharge: Partial<Bien> = {}): Bien {
  return {
    id: "bien-test",
    reference: "TEST-001",
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

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

describe("deriverHistoriqueBien", () => {
  it("ne produit aucun événement pour un bien mocké sans creeLe et sans action", () => {
    expect(deriverHistoriqueBien(bienTest({ creeLe: undefined }), [])).toEqual([]);
  });

  it("produit « Bien créé » à partir de bien.creeLe", () => {
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: "2026-01-05T09:00:00.000Z" }), []);
    expect(evenements).toEqual([{ date: "2026-01-05T09:00:00.000Z", texte: "Bien créé" }]);
  });

  it("produit « Action créée » à partir de action.creeLe", () => {
    const action = actionTest({ titre: "Relancer les Dubois" });
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [action]);
    expect(evenements).toEqual([{ date: action.creeLe, texte: "Action créée : Relancer les Dubois" }]);
  });

  it("produit aussi « Action terminée » quand l'action est terminée", () => {
    const action = actionTest({
      titre: "Relire le compromis",
      statut: "termine",
      termineLe: "2026-08-05T14:00:00.000Z",
    });
    const evenements = deriverHistoriqueBien(bienTest({ creeLe: undefined }), [action]);

    expect(evenements).toEqual([
      { date: "2026-08-05T14:00:00.000Z", texte: "Action terminée : Relire le compromis" },
      { date: "2026-08-01T10:00:00.000Z", texte: "Action créée : Relire le compromis" },
    ]);
  });

  it("trie tous les événements par date décroissante", () => {
    const bien = bienTest({ creeLe: "2026-01-01T00:00:00.000Z" });
    const action = actionTest({
      titre: "Envoyer les diagnostics",
      creeLe: "2026-06-01T00:00:00.000Z",
      statut: "termine",
      termineLe: "2026-07-01T00:00:00.000Z",
    });

    const evenements = deriverHistoriqueBien(bien, [action]);

    expect(evenements.map((e) => e.date)).toEqual([
      "2026-07-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });
});
