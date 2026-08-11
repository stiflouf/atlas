import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import { produirePointsForts } from "./moteur";

// Objets minimaux, créés uniquement pour ces tests — ne touchent à aucun mock métier réel.
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

function acquereurTest(surcharge: Partial<ProfilAcquereur> = {}): ProfilAcquereur {
  return {
    id: "client-test",
    prenom: "Test",
    nom: "Testeur",
    email: "test@example.com",
    telephone: "0000000000",
    budgetMin: 100000,
    budgetMax: 400000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  };
}

describe("produirePointsForts", () => {
  it("déclenche parking_bonus quand le bien a un parking non demandé par l'acquéreur", () => {
    const points = produirePointsForts({
      bien: bienTest({ parking: true }),
      acquereur: acquereurTest(),
    });
    expect(points.map((p) => p.id)).toEqual(["parking_bonus"]);
  });

  it("déclenche exterieur_bonus quand le bien a un extérieur non demandé par l'acquéreur", () => {
    const points = produirePointsForts({
      bien: bienTest({ exterieur: "balcon" }),
      acquereur: acquereurTest(),
    });
    expect(points.map((p) => p.id)).toEqual(["exterieur_bonus"]);
  });

  it("ne déclenche aucune règle quand les bonus correspondent à des critères explicitement demandés", () => {
    const points = produirePointsForts({
      bien: bienTest({ parking: true, exterieur: "jardin" }),
      acquereur: acquereurTest({ necessiteParking: true, necessiteExterieur: true }),
    });
    expect(points).toEqual([]);
  });

  it("ne déclenche aucune règle quand les champs du bien sont inconnus (undefined), jamais interprétés comme absents", () => {
    const points = produirePointsForts({
      bien: bienTest({ parking: undefined, exterieur: undefined }),
      acquereur: acquereurTest({ necessiteParking: undefined, necessiteExterieur: undefined }),
    });
    expect(points).toEqual([]);
  });
});
