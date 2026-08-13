import { describe, expect, it } from "vitest";
import type { Tache } from "@/types/tache";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import { selectionnerActionsEnCours, selectionnerComptesRendusRecents, selectionnerHistoriqueRecent } from "./memoireDossier";

function compteRenduTest(surcharge: Partial<CompteRenduVisite> = {}): CompteRenduVisite {
  return {
    id: "cr-test",
    bienId: "bien-test",
    acquereurId: "acquereur-a",
    dateVisite: "2026-08-01",
    retour: "Retour de test",
    interet: "interesse",
    creeLe: "2026-08-01T18:00:00.000Z",
    ...surcharge,
  };
}

function tacheTest(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "tache-test",
    titre: "Tâche de test",
    priorite: "normale",
    type: "autre",
    origine: "manuelle",
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("selectionnerActionsEnCours", () => {
  const maintenant = new Date("2026-08-11T12:00:00.000Z");

  it("fusionne bien et acquéreur en taguant la provenance", () => {
    const bien = [tacheTest({ id: "b1" })];
    const acquereur = [tacheTest({ id: "a1" })];

    const resultat = selectionnerActionsEnCours(bien, acquereur, maintenant);

    expect(resultat.map((t) => [t.id, t.provenance])).toEqual(
      expect.arrayContaining([
        ["b1", "bien"],
        ["a1", "acquereur"],
      ])
    );
  });

  it("exclut les tâches terminées", () => {
    const bien = [tacheTest({ id: "b1", termineeLe: "2026-08-05T00:00:00.000Z" })];
    expect(selectionnerActionsEnCours(bien, [], maintenant)).toEqual([]);
  });

  it("exclut les tâches annulées", () => {
    const bien = [tacheTest({ id: "b1", annuleeLe: "2026-08-05T00:00:00.000Z" })];
    expect(selectionnerActionsEnCours(bien, [], maintenant)).toEqual([]);
  });

  it("trie par scoreTache décroissant et plafonne au maximum demandé", () => {
    const bien = [
      tacheTest({ id: "basse", priorite: "basse" }),
      tacheTest({ id: "haute", priorite: "haute" }),
      tacheTest({ id: "normale", priorite: "normale" }),
    ];

    const resultat = selectionnerActionsEnCours(bien, [], maintenant, 2);

    expect(resultat.map((t) => t.id)).toEqual(["haute", "normale"]);
  });
});

describe("selectionnerHistoriqueRecent", () => {
  it("ne retient que les tâches terminées, jamais les créations", () => {
    const taches = [tacheTest({ id: "ouverte", titre: "Ouverte" })];
    expect(selectionnerHistoriqueRecent(taches)).toEqual([]);
  });

  it("ne retient pas les tâches annulées", () => {
    const taches = [tacheTest({ id: "annulee", titre: "Annulée", annuleeLe: "2026-08-05T14:00:00.000Z" })];
    expect(selectionnerHistoriqueRecent(taches)).toEqual([]);
  });

  it("produit « Tâche terminée : {titre} » daté par termineeLe", () => {
    const taches = [
      tacheTest({ id: "t1", titre: "Envoyer les diagnostics", termineeLe: "2026-08-05T14:00:00.000Z" }),
    ];
    expect(selectionnerHistoriqueRecent(taches)).toEqual([
      { date: "2026-08-05T14:00:00.000Z", texte: "Tâche terminée : Envoyer les diagnostics" },
    ]);
  });

  it("trie par date décroissante et plafonne au maximum demandé", () => {
    const taches = [
      tacheTest({ id: "t1", titre: "Ancienne", termineeLe: "2026-08-01T00:00:00.000Z" }),
      tacheTest({ id: "t2", titre: "Récente", termineeLe: "2026-08-10T00:00:00.000Z" }),
      tacheTest({ id: "t3", titre: "Intermédiaire", termineeLe: "2026-08-05T00:00:00.000Z" }),
    ];

    const resultat = selectionnerHistoriqueRecent(taches, 2);

    expect(resultat.map((e) => e.texte)).toEqual(["Tâche terminée : Récente", "Tâche terminée : Intermédiaire"]);
  });
});

describe("selectionnerComptesRendusRecents", () => {
  it("ne retient que les comptes rendus du bon acquéreur", () => {
    const deLAcquereur = compteRenduTest({ id: "cr-a", acquereurId: "acquereur-a" });
    const dUnAutre = compteRenduTest({ id: "cr-b", acquereurId: "acquereur-b" });

    const resultat = selectionnerComptesRendusRecents([deLAcquereur, dUnAutre], "acquereur-a");

    expect(resultat.map((cr) => cr.id)).toEqual(["cr-a"]);
  });

  it("trie par dateVisite décroissante même si la liste fournie n'est pas déjà triée", () => {
    // Volontairement dans le désordre et avec une date la plus ancienne en tête, pour vérifier
    // que la fonction ne dépend jamais implicitement de l'ordre fourni par l'appelant.
    const ancien = compteRenduTest({ id: "ancien", dateVisite: "2026-06-01" });
    const recent = compteRenduTest({ id: "recent", dateVisite: "2026-08-10" });
    const intermediaire = compteRenduTest({ id: "intermediaire", dateVisite: "2026-07-15" });

    const resultat = selectionnerComptesRendusRecents([ancien, recent, intermediaire], "acquereur-a");

    expect(resultat.map((cr) => cr.id)).toEqual(["recent", "intermediaire", "ancien"]);
  });

  it("plafonne au maximum demandé", () => {
    const comptesRendus = [
      compteRenduTest({ id: "cr-1", dateVisite: "2026-08-01" }),
      compteRenduTest({ id: "cr-2", dateVisite: "2026-08-02" }),
      compteRenduTest({ id: "cr-3", dateVisite: "2026-08-03" }),
      compteRenduTest({ id: "cr-4", dateVisite: "2026-08-04" }),
    ];

    const resultat = selectionnerComptesRendusRecents(comptesRendus, "acquereur-a", 3);

    expect(resultat).toHaveLength(3);
    expect(resultat.map((cr) => cr.id)).toEqual(["cr-4", "cr-3", "cr-2"]);
  });
});
