import { describe, expect, it } from "vitest";
import { scoreAlerte, trierParPriorite } from "./priorite";
import type { AlerteCopilote } from "@/types/alerte";

function alerteTest(surcharge: Partial<AlerteCopilote> = {}): AlerteCopilote {
  return {
    id: "alerte-test",
    type: "regle_legale_absente",
    categorie: "donnees_incompletes",
    niveau: "attention",
    titre: "Titre de test",
    explication: "Explication de test",
    donneesDeclencheuses: {},
    provenance: [],
    ...surcharge,
  };
}

describe("scoreAlerte", () => {
  it("le niveau domine toujours le poids du type (action_requise > attention > information)", () => {
    const actionRequise = alerteTest({ niveau: "action_requise", type: "historique_run_rate_insuffisant" }); // type le plus faible
    const attention = alerteTest({ niveau: "attention", type: "profil_fiscal_absent" }); // type le plus fort
    expect(scoreAlerte(actionRequise)).toBeGreaterThan(scoreAlerte(attention));
  });

  it("aucun score n'est jamais négatif ou instable pour un même type/niveau (déterminisme)", () => {
    const a = alerteTest({ id: "a1" });
    const b = alerteTest({ id: "a2" });
    expect(scoreAlerte(a)).toBe(scoreAlerte(b));
  });
});

describe("trierParPriorite", () => {
  it("trie profil absent avant assiette incomplète avant rémunération manquante avant règles hypothétiques", () => {
    const profilAbsent = alerteTest({ id: "z", type: "profil_fiscal_absent", niveau: "action_requise" });
    const assietteIncomplete = alerteTest({ id: "y", type: "assiette_incomplete", niveau: "action_requise" });
    const remunerationManquante = alerteTest({ id: "x", type: "remuneration_manquante", niveau: "attention" });
    const reglesHypothetiques = alerteTest({ id: "w", type: "regles_futures_hypothetiques", niveau: "information" });

    const resultat = trierParPriorite([reglesHypothetiques, remunerationManquante, assietteIncomplete, profilAbsent]);

    expect(resultat.map((a) => a.type)).toEqual([
      "profil_fiscal_absent",
      "assiette_incomplete",
      "remuneration_manquante",
      "regles_futures_hypothetiques",
    ]);
  });

  it("départage par id (ordre alphabétique stable) quand le score est strictement identique", () => {
    const b = alerteTest({ id: "b-alerte" });
    const a = alerteTest({ id: "a-alerte" });
    const resultat = trierParPriorite([b, a]);
    expect(resultat.map((x) => x.id)).toEqual(["a-alerte", "b-alerte"]);
  });

  it("ne réordonne jamais le tableau reçu en entrée (fonction pure)", () => {
    const entree = [alerteTest({ id: "b" }), alerteTest({ id: "a" })];
    const copie = [...entree];
    trierParPriorite(entree);
    expect(entree).toEqual(copie);
  });
});
