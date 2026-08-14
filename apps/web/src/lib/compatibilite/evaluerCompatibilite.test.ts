import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import { evaluerCompatibilite } from "./evaluerCompatibilite";
import {
  evaluerAccessibilite,
  evaluerBudgetMax,
  evaluerExterieur,
  evaluerParking,
  evaluerPieces,
  evaluerSurface,
} from "./criteres";

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
    pieces: 3,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: ["parking obligatoire", "cherche terrasse", "5e sans ascenseur"],
    description: "5e sans ascenseur, parking obligatoire, cherche terrasse",
    ...surcharge,
  };
}

function acquereurTest(surcharge: Partial<ProfilAcquereur> = {}): ProfilAcquereur {
  return {
    id: "acquereur-test",
    prenom: "Jean",
    nom: "Dupont",
    email: "jean@example.com",
    telephone: "0600000000",
    budgetMin: 200000,
    budgetMax: 400000,
    criteres: ["parking obligatoire", "cherche terrasse"],
    stadeProjet: "recherche_active",
    notes: "5e sans ascenseur, parking obligatoire, cherche terrasse",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  };
}

describe("evaluerBudgetMax", () => {
  it("compatible quand le prix est strictement inférieur au budget max", () => {
    const r = evaluerBudgetMax(bienTest({ prix: 300000 }), acquereurTest({ budgetMax: 400000 }));
    expect(r.statut).toBe("compatible");
  });

  it("compatible quand le prix est exactement égal au budget max", () => {
    const r = evaluerBudgetMax(bienTest({ prix: 400000 }), acquereurTest({ budgetMax: 400000 }));
    expect(r.statut).toBe("compatible");
  });

  it("incompatible quand le prix dépasse le budget max", () => {
    const r = evaluerBudgetMax(bienTest({ prix: 400001 }), acquereurTest({ budgetMax: 400000 }));
    expect(r.statut).toBe("incompatible");
  });

  it("n'est jamais non_concerne ni a_verifier (contrainte dure toujours évaluable)", () => {
    const r = evaluerBudgetMax(bienTest(), acquereurTest());
    expect(["compatible", "incompatible"]).toContain(r.statut);
  });

  it("budgetMin n'influence jamais le résultat, quelle que soit sa valeur", () => {
    const bien = bienTest({ prix: 100000 }); // très inférieur à budgetMin
    const avecBudgetMinEleve = evaluerBudgetMax(bien, acquereurTest({ budgetMin: 350000, budgetMax: 400000 }));
    const avecBudgetMinNul = evaluerBudgetMax(bien, acquereurTest({ budgetMin: 0, budgetMax: 400000 }));
    expect(avecBudgetMinEleve.statut).toBe("compatible");
    expect(avecBudgetMinNul.statut).toBe("compatible");
    expect(avecBudgetMinEleve).toEqual(avecBudgetMinNul);
  });
});

describe("evaluerPieces", () => {
  it("non_concerne quand piecesMin est absent", () => {
    const r = evaluerPieces(bienTest({ pieces: 1 }), acquereurTest({ piecesMin: undefined }));
    expect(r.statut).toBe("non_concerne");
  });

  it("compatible quand le bien a exactement piecesMin", () => {
    const r = evaluerPieces(bienTest({ pieces: 3 }), acquereurTest({ piecesMin: 3 }));
    expect(r.statut).toBe("compatible");
  });

  it("compatible quand le bien a plus que piecesMin", () => {
    const r = evaluerPieces(bienTest({ pieces: 5 }), acquereurTest({ piecesMin: 3 }));
    expect(r.statut).toBe("compatible");
  });

  it("incompatible quand le bien a moins que piecesMin", () => {
    const r = evaluerPieces(bienTest({ pieces: 2 }), acquereurTest({ piecesMin: 3 }));
    expect(r.statut).toBe("incompatible");
  });
});

describe("evaluerSurface", () => {
  it("non_concerne quand surfaceMin est absent", () => {
    const r = evaluerSurface(bienTest({ surface: 5 }), acquereurTest({ surfaceMin: undefined }));
    expect(r.statut).toBe("non_concerne");
  });

  it("compatible quand la surface du bien est exactement surfaceMin", () => {
    const r = evaluerSurface(bienTest({ surface: 50 }), acquereurTest({ surfaceMin: 50 }));
    expect(r.statut).toBe("compatible");
  });

  it("compatible quand la surface du bien dépasse surfaceMin", () => {
    const r = evaluerSurface(bienTest({ surface: 80 }), acquereurTest({ surfaceMin: 50 }));
    expect(r.statut).toBe("compatible");
  });

  it("incompatible quand la surface du bien est inférieure à surfaceMin", () => {
    const r = evaluerSurface(bienTest({ surface: 30 }), acquereurTest({ surfaceMin: 50 }));
    expect(r.statut).toBe("incompatible");
  });
});

describe("evaluerParking", () => {
  it("non_concerne quand necessiteParking n'est pas true (absent)", () => {
    const r = evaluerParking(bienTest({ parking: false }), acquereurTest({ necessiteParking: undefined }));
    expect(r.statut).toBe("non_concerne");
  });

  it("non_concerne quand necessiteParking est explicitement false", () => {
    const r = evaluerParking(bienTest({ parking: false }), acquereurTest({ necessiteParking: false }));
    expect(r.statut).toBe("non_concerne");
  });

  it("compatible quand requis et bien.parking === true", () => {
    const r = evaluerParking(bienTest({ parking: true }), acquereurTest({ necessiteParking: true }));
    expect(r.statut).toBe("compatible");
  });

  it("incompatible quand requis et bien.parking === false", () => {
    const r = evaluerParking(bienTest({ parking: false }), acquereurTest({ necessiteParking: true }));
    expect(r.statut).toBe("incompatible");
  });

  it("a_verifier quand requis et bien.parking est inconnu (undefined) — jamais incompatible", () => {
    const r = evaluerParking(bienTest({ parking: undefined }), acquereurTest({ necessiteParking: true }));
    expect(r.statut).toBe("a_verifier");
  });
});

describe("evaluerExterieur", () => {
  it("non_concerne quand necessiteExterieur n'est pas true", () => {
    const r = evaluerExterieur(bienTest({ exterieur: "aucun" }), acquereurTest({ necessiteExterieur: undefined }));
    expect(r.statut).toBe("non_concerne");
  });

  it("compatible pour balcon/terrasse/jardin quand requis", () => {
    for (const exterieur of ["balcon", "terrasse", "jardin"] as const) {
      const r = evaluerExterieur(bienTest({ exterieur }), acquereurTest({ necessiteExterieur: true }));
      expect(r.statut).toBe("compatible");
    }
  });

  it("incompatible quand requis et bien.exterieur === 'aucun'", () => {
    const r = evaluerExterieur(bienTest({ exterieur: "aucun" }), acquereurTest({ necessiteExterieur: true }));
    expect(r.statut).toBe("incompatible");
  });

  it("a_verifier quand requis et bien.exterieur est inconnu — jamais incompatible", () => {
    const r = evaluerExterieur(bienTest({ exterieur: undefined }), acquereurTest({ necessiteExterieur: true }));
    expect(r.statut).toBe("a_verifier");
  });

  it("ne déduit jamais un extérieur depuis caracteristiques/description même si elles mentionnent une terrasse", () => {
    const bien = bienTest({
      exterieur: undefined,
      caracteristiques: ["Terrasse magnifique", "Jardin arboré"],
      description: "Superbe jardin avec terrasse plein sud",
    });
    const r = evaluerExterieur(bien, acquereurTest({ necessiteExterieur: true }));
    expect(r.statut).toBe("a_verifier");
  });
});

describe("evaluerAccessibilite", () => {
  it("non_concerne quand accessibiliteRequise n'est pas true", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 5, ascenseur: false }), acquereurTest({ accessibiliteRequise: undefined }));
    expect(r.statut).toBe("non_concerne");
  });

  it("étage undefined → a_verifier", () => {
    const r = evaluerAccessibilite(bienTest({ etage: undefined, ascenseur: true }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("a_verifier");
  });

  it("RDC (étage 0) + ascenseur undefined → compatible", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 0, ascenseur: undefined }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("compatible");
  });

  it("RDC (étage 0) + ascenseur false → compatible", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 0, ascenseur: false }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("compatible");
  });

  it("RDC (étage 0) + ascenseur true → compatible", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 0, ascenseur: true }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("compatible");
  });

  it("étage 2 + ascenseur true → compatible", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 2, ascenseur: true }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("compatible");
  });

  it("étage 2 + ascenseur false → incompatible", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 2, ascenseur: false }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("incompatible");
  });

  it("étage 2 + ascenseur undefined → a_verifier", () => {
    const r = evaluerAccessibilite(bienTest({ etage: 2, ascenseur: undefined }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("a_verifier");
  });

  it("étage négatif (hors modèle applicatif) → a_verifier, jamais une hypothèse", () => {
    const r = evaluerAccessibilite(bienTest({ etage: -1, ascenseur: true }), acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("a_verifier");
  });

  it("ne déduit jamais l'accessibilité depuis un texte libre mentionnant l'absence d'ascenseur", () => {
    const bien = bienTest({
      etage: undefined,
      ascenseur: undefined,
      caracteristiques: ["5e sans ascenseur"],
      description: "Appartement au 5e étage, sans ascenseur",
    });
    const r = evaluerAccessibilite(bien, acquereurTest({ accessibiliteRequise: true }));
    expect(r.statut).toBe("a_verifier");
  });
});

describe("evaluerCompatibilite — agrégation globale", () => {
  it("tout compatible/non_concerne → statutGlobal compatible", () => {
    const resultat = evaluerCompatibilite(
      bienTest({ prix: 300000, pieces: 3, surface: 50, parking: true, exterieur: "jardin", etage: 0 }),
      acquereurTest({
        budgetMax: 400000,
        piecesMin: undefined,
        surfaceMin: undefined,
        necessiteParking: undefined,
        necessiteExterieur: undefined,
        accessibiliteRequise: undefined,
      })
    );
    expect(resultat.statutGlobal).toBe("compatible");
  });

  it("un seul a_verifier, aucun incompatible → statutGlobal a_verifier", () => {
    const resultat = evaluerCompatibilite(
      bienTest({ prix: 300000, pieces: 5, surface: 80, parking: undefined, exterieur: "jardin", etage: 0 }),
      acquereurTest({
        budgetMax: 400000,
        piecesMin: 3,
        surfaceMin: 50,
        necessiteParking: true,
        necessiteExterieur: undefined,
        accessibiliteRequise: undefined,
      })
    );
    expect(resultat.statutGlobal).toBe("a_verifier");
  });

  it("un incompatible et plusieurs a_verifier → statutGlobal incompatible (priorité absolue)", () => {
    const resultat = evaluerCompatibilite(
      bienTest({ prix: 500000, pieces: 5, surface: 80, parking: undefined, exterieur: undefined, etage: undefined }),
      acquereurTest({
        budgetMax: 400000, // incompatible
        piecesMin: 3,
        surfaceMin: 50,
        necessiteParking: true, // a_verifier
        necessiteExterieur: true, // a_verifier
        accessibiliteRequise: true, // a_verifier
      })
    );
    expect(resultat.statutGlobal).toBe("incompatible");
    const statuts = resultat.criteres.map((c) => c.statut);
    expect(statuts.filter((s) => s === "incompatible")).toHaveLength(1);
    expect(statuts.filter((s) => s === "a_verifier").length).toBeGreaterThanOrEqual(2);
  });

  it("les critères non_concerne sont ignorés pour le statut global", () => {
    const resultat = evaluerCompatibilite(
      bienTest({ prix: 300000, pieces: 1, surface: 5, parking: false, exterieur: "aucun", etage: 5, ascenseur: false }),
      acquereurTest({
        budgetMax: 400000,
        piecesMin: undefined,
        surfaceMin: undefined,
        necessiteParking: undefined,
        necessiteExterieur: undefined,
        accessibiliteRequise: undefined,
      })
    );
    // Tous les critères non pertinents sont non_concerne malgré des valeurs "défavorables" côté
    // bien — seul budget_max reste pertinent et compatible.
    expect(resultat.statutGlobal).toBe("compatible");
    expect(resultat.criteres.filter((c) => c.statut === "non_concerne")).toHaveLength(5);
  });

  it("retourne bienId/acquereurId issus des entités passées", () => {
    const resultat = evaluerCompatibilite(bienTest({ id: "bien-42" }), acquereurTest({ id: "acquereur-99" }));
    expect(resultat.bienId).toBe("bien-42");
    expect(resultat.acquereurId).toBe("acquereur-99");
  });

  it("expose exactement 6 critères, avec des identifiants stables", () => {
    const resultat = evaluerCompatibilite(bienTest(), acquereurTest());
    expect(resultat.criteres.map((c) => c.critere).sort()).toEqual(
      ["accessibilite", "budget_max", "exterieur", "parking", "pieces_min", "surface_min"].sort()
    );
  });

  it("est déterministe : même bien/acquéreur → même résultat, plusieurs appels successifs", () => {
    const bien = bienTest();
    const acquereur = acquereurTest();
    const r1 = evaluerCompatibilite(bien, acquereur);
    const r2 = evaluerCompatibilite(bien, acquereur);
    const r3 = evaluerCompatibilite(bien, acquereur);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it("n'interprète jamais un texte libre contenant des exigences non structurées (non-régression)", () => {
    // Le bien/acquéreur de test embarquent volontairement "parking obligatoire", "cherche
    // terrasse", "5e sans ascenseur" dans caracteristiques/description/criteres/notes — aucun de
    // ces textes ne doit influencer le résultat tant que les champs structurés correspondants
    // restent absents.
    const bienSansChampsStructures = bienTest({ parking: undefined, exterieur: undefined, etage: undefined, ascenseur: undefined });
    const acquereurAvecTexteLibre = acquereurTest({
      necessiteParking: undefined,
      necessiteExterieur: undefined,
      accessibiliteRequise: undefined,
    });
    const resultat = evaluerCompatibilite(bienSansChampsStructures, acquereurAvecTexteLibre);
    // Sans exigence structurée, parking/exterieur/accessibilite sont non_concerne — jamais
    // influencés par le texte libre qui, lui, exprime pourtant ces mêmes besoins en clair.
    const critereParking = resultat.criteres.find((c) => c.critere === "parking");
    const critereExterieur = resultat.criteres.find((c) => c.critere === "exterieur");
    const critereAccessibilite = resultat.criteres.find((c) => c.critere === "accessibilite");
    expect(critereParking?.statut).toBe("non_concerne");
    expect(critereExterieur?.statut).toBe("non_concerne");
    expect(critereAccessibilite?.statut).toBe("non_concerne");
    expect(resultat.statutGlobal).toBe("compatible");

    // Reproduit le même résultat même en vidant complètement le texte libre : la seule chose qui
    // doit compter est l'absence des champs structurés, jamais la présence/absence de texte.
    const bienSansTexte = bienTest({
      parking: undefined,
      exterieur: undefined,
      etage: undefined,
      ascenseur: undefined,
      caracteristiques: [],
      description: "",
    });
    const acquereurSansTexte = acquereurTest({
      necessiteParking: undefined,
      necessiteExterieur: undefined,
      accessibiliteRequise: undefined,
      criteres: [],
      notes: "",
    });
    const resultatSansTexte = evaluerCompatibilite(bienSansTexte, acquereurSansTexte);
    expect(resultatSansTexte).toEqual(resultat);
  });
});
