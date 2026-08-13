import { describe, expect, it } from "vitest";
import { dedupliquerAlertes } from "./deduplication";
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

describe("Profil absent absorbe les alertes fiscales dépendantes, jamais les commerciales", () => {
  it("supprime les alertes fiscales quand profil_fiscal_absent est présente", () => {
    const resultat = dedupliquerAlertes([
      alerteTest({ id: "a1", type: "profil_fiscal_absent", niveau: "action_requise", titre: "Profil absent" }),
      alerteTest({ id: "a2", type: "assiette_incomplete", titre: "Assiette incomplète" }),
      alerteTest({ id: "a3", type: "regime_non_couvert", titre: "Régime non couvert" }),
    ]);
    expect(resultat.map((a) => a.type)).toEqual(["profil_fiscal_absent"]);
  });

  it("garde les alertes purement commerciales même quand profil_fiscal_absent est présente", () => {
    const resultat = dedupliquerAlertes([
      alerteTest({ id: "a1", type: "profil_fiscal_absent", niveau: "action_requise", titre: "Profil absent" }),
      alerteTest({ id: "a2", type: "remuneration_manquante", categorie: "commercial", titre: "Rémunération manquante" }),
      alerteTest({ id: "a3", type: "date_encaissement_prevue_manquante", categorie: "commercial", titre: "Date manquante" }),
      alerteTest({ id: "a4", type: "encaissement_attendu_depasse", categorie: "commercial", titre: "Encaissement dépassé" }),
    ]);
    expect(resultat.map((a) => a.type).sort()).toEqual(
      ["date_encaissement_prevue_manquante", "encaissement_attendu_depasse", "profil_fiscal_absent", "remuneration_manquante"].sort()
    );
  });
});

describe("Assiette incomplète absorbe A7, jamais D3", () => {
  it("supprime historique_run_rate_insuffisant quand assiette_incomplete est présente", () => {
    const resultat = dedupliquerAlertes([
      alerteTest({ id: "a1", type: "assiette_incomplete", titre: "Assiette incomplète" }),
      alerteTest({ id: "a2", type: "historique_run_rate_insuffisant", titre: "Historique insuffisant" }),
    ]);
    expect(resultat.map((a) => a.type)).toEqual(["assiette_incomplete"]);
  });

  it("ne supprime jamais regles_futures_hypothetiques (cause indépendante)", () => {
    const resultat = dedupliquerAlertes([
      alerteTest({ id: "a1", type: "assiette_incomplete", titre: "Assiette incomplète" }),
      alerteTest({ id: "a2", type: "regles_futures_hypothetiques", titre: "Règles hypothétiques" }),
    ]);
    expect(resultat.map((a) => a.type).sort()).toEqual(["assiette_incomplete", "regles_futures_hypothetiques"]);
  });
});

describe("Filets de sécurité", () => {
  it("déduplique deux alertes de même id déterministe", () => {
    const resultat = dedupliquerAlertes([alerteTest({ id: "meme-id", titre: "Titre A" }), alerteTest({ id: "meme-id", titre: "Titre A" })]);
    expect(resultat).toHaveLength(1);
  });

  it("déduplique en dernier recours deux alertes d'id différent mais de libellé strictement identique", () => {
    const resultat = dedupliquerAlertes([
      alerteTest({ id: "id-1", titre: "Même titre" }),
      alerteTest({ id: "id-2", titre: "Même titre" }),
    ]);
    expect(resultat).toHaveLength(1);
  });

  it("ne fusionne jamais deux alertes de titres réellement différents", () => {
    const resultat = dedupliquerAlertes([alerteTest({ id: "id-1", titre: "Titre A" }), alerteTest({ id: "id-2", titre: "Titre B" })]);
    expect(resultat).toHaveLength(2);
  });
});
