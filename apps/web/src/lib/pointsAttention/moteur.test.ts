import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { ProfilAcquereur } from "@/types/client";
import type { TransportsProximite, VelibProximite } from "@/types/transports";
import { produirePointsAttention } from "./moteur";

// Tests de caractérisation : verrouillent le comportement ACTUEL de produirePointsAttention avant
// tout refactor (ADR-034, section 11 étape A) — ce moteur n'avait jusqu'ici aucun test. Servent de
// filet de sécurité : une fois regleAccessibilite/reglePiecesInsuffisantes/regleSurfaceInsuffisante/
// regleParkingManquant/regleExterieurManquant/reglePrixSuperieurBudgetMax réécrites pour s'appuyer
// sur src/lib/compatibilite/criteres.ts, ce fichier doit rester vert sans aucune modification.

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
    caracteristiques: [],
    description: "",
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
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
    ...surcharge,
  };
}

function transports(arrets: unknown[] = []): TransportsProximite {
  return { arrets: arrets as TransportsProximite["arrets"], source: "prim_idfm_navitia", recupereLe: "2026-01-01T00:00:00.000Z" };
}

function velib(stations: unknown[] = []): VelibProximite {
  return { stations: stations as VelibProximite["stations"], source: "velib_metropole_gbfs", recupereLe: "2026-01-01T00:00:00.000Z" };
}

describe("produirePointsAttention — caractérisation (avant refactor ADR-034)", () => {
  describe("prix_superieur_budget_max", () => {
    it("se déclenche quand le prix dépasse le budget max", () => {
      const points = produirePointsAttention({
        bien: bienTest({ prix: 500000 }),
        acquereur: acquereurTest({ budgetMax: 400000 }),
      });
      expect(points.map((p) => p.id)).toContain("prix_superieur_budget_max");
    });

    it("ne se déclenche pas quand le prix est égal au budget max", () => {
      const points = produirePointsAttention({
        bien: bienTest({ prix: 400000 }),
        acquereur: acquereurTest({ budgetMax: 400000 }),
      });
      expect(points.map((p) => p.id)).not.toContain("prix_superieur_budget_max");
    });

    it("ne se déclenche pas quand le prix est inférieur au budget max", () => {
      const points = produirePointsAttention({
        bien: bienTest({ prix: 300000 }),
        acquereur: acquereurTest({ budgetMax: 400000 }),
      });
      expect(points.map((p) => p.id)).not.toContain("prix_superieur_budget_max");
    });
  });

  describe("mandat_non_actif", () => {
    it("se déclenche si le mandat n'est pas actif", () => {
      const points = produirePointsAttention({
        bien: bienTest({ statutMandat: "suspendu" }),
        acquereur: acquereurTest(),
      });
      expect(points.map((p) => p.id)).toContain("mandat_non_actif");
    });

    it("ne se déclenche pas si le mandat est actif", () => {
      const points = produirePointsAttention({
        bien: bienTest({ statutMandat: "actif" }),
        acquereur: acquereurTest(),
      });
      expect(points.map((p) => p.id)).not.toContain("mandat_non_actif");
    });
  });

  describe("aucun_transport_proche", () => {
    it("ne se déclenche pas si transports/velib sont absents (appel non effectué)", () => {
      const points = produirePointsAttention({ bien: bienTest(), acquereur: acquereurTest() });
      expect(points.map((p) => p.id)).not.toContain("aucun_transport_proche");
    });

    it("se déclenche si les deux réponses sont vides", () => {
      const points = produirePointsAttention({
        bien: bienTest(),
        acquereur: acquereurTest(),
        transports: transports([]),
        velib: velib([]),
      });
      expect(points.map((p) => p.id)).toContain("aucun_transport_proche");
    });

    it("ne se déclenche pas si au moins un arrêt existe", () => {
      const points = produirePointsAttention({
        bien: bienTest(),
        acquereur: acquereurTest(),
        transports: transports([{}]),
        velib: velib([]),
      });
      expect(points.map((p) => p.id)).not.toContain("aucun_transport_proche");
    });
  });

  describe("accessibilite_requise", () => {
    it("ne se déclenche pas si l'accessibilité n'est pas requise", () => {
      const points = produirePointsAttention({
        bien: bienTest({ etage: 3, ascenseur: false }),
        acquereur: acquereurTest({ accessibiliteRequise: false }),
      });
      expect(points.map((p) => p.id)).not.toContain("accessibilite_requise");
    });

    it("ne se déclenche pas si l'étage est inconnu", () => {
      const points = produirePointsAttention({
        bien: bienTest({ etage: undefined, ascenseur: false }),
        acquereur: acquereurTest({ accessibiliteRequise: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("accessibilite_requise");
    });

    it("ne se déclenche pas si l'ascenseur est inconnu", () => {
      const points = produirePointsAttention({
        bien: bienTest({ etage: 3, ascenseur: undefined }),
        acquereur: acquereurTest({ accessibiliteRequise: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("accessibilite_requise");
    });

    it("ne se déclenche pas au rez-de-chaussée (étage 0)", () => {
      const points = produirePointsAttention({
        bien: bienTest({ etage: 0, ascenseur: false }),
        acquereur: acquereurTest({ accessibiliteRequise: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("accessibilite_requise");
    });

    it("se déclenche à l'étage sans ascenseur", () => {
      const points = produirePointsAttention({
        bien: bienTest({ etage: 3, ascenseur: false }),
        acquereur: acquereurTest({ accessibiliteRequise: true }),
      });
      expect(points.map((p) => p.id)).toContain("accessibilite_requise");
    });

    it("ne se déclenche pas à l'étage avec ascenseur", () => {
      const points = produirePointsAttention({
        bien: bienTest({ etage: 3, ascenseur: true }),
        acquereur: acquereurTest({ accessibiliteRequise: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("accessibilite_requise");
    });
  });

  describe("pieces_insuffisantes", () => {
    it("ne se déclenche pas si piecesMin est absent", () => {
      const points = produirePointsAttention({
        bien: bienTest({ pieces: 1 }),
        acquereur: acquereurTest({ piecesMin: undefined }),
      });
      expect(points.map((p) => p.id)).not.toContain("pieces_insuffisantes");
    });

    it("se déclenche si le bien a moins de pièces que piecesMin", () => {
      const points = produirePointsAttention({
        bien: bienTest({ pieces: 2 }),
        acquereur: acquereurTest({ piecesMin: 3 }),
      });
      expect(points.map((p) => p.id)).toContain("pieces_insuffisantes");
    });

    it("ne se déclenche pas si le bien a exactement piecesMin", () => {
      const points = produirePointsAttention({
        bien: bienTest({ pieces: 3 }),
        acquereur: acquereurTest({ piecesMin: 3 }),
      });
      expect(points.map((p) => p.id)).not.toContain("pieces_insuffisantes");
    });
  });

  describe("surface_insuffisante", () => {
    it("ne se déclenche pas si surfaceMin est absent", () => {
      const points = produirePointsAttention({
        bien: bienTest({ surface: 10 }),
        acquereur: acquereurTest({ surfaceMin: undefined }),
      });
      expect(points.map((p) => p.id)).not.toContain("surface_insuffisante");
    });

    it("se déclenche si le bien est plus petit que surfaceMin", () => {
      const points = produirePointsAttention({
        bien: bienTest({ surface: 30 }),
        acquereur: acquereurTest({ surfaceMin: 50 }),
      });
      expect(points.map((p) => p.id)).toContain("surface_insuffisante");
    });

    it("ne se déclenche pas si le bien a exactement surfaceMin", () => {
      const points = produirePointsAttention({
        bien: bienTest({ surface: 50 }),
        acquereur: acquereurTest({ surfaceMin: 50 }),
      });
      expect(points.map((p) => p.id)).not.toContain("surface_insuffisante");
    });
  });

  describe("parking_manquant", () => {
    it("ne se déclenche pas si le parking n'est pas requis", () => {
      const points = produirePointsAttention({
        bien: bienTest({ parking: false }),
        acquereur: acquereurTest({ necessiteParking: false }),
      });
      expect(points.map((p) => p.id)).not.toContain("parking_manquant");
    });

    it("ne se déclenche pas si le parking est inconnu", () => {
      const points = produirePointsAttention({
        bien: bienTest({ parking: undefined }),
        acquereur: acquereurTest({ necessiteParking: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("parking_manquant");
    });

    it("se déclenche si le parking est requis et absent", () => {
      const points = produirePointsAttention({
        bien: bienTest({ parking: false }),
        acquereur: acquereurTest({ necessiteParking: true }),
      });
      expect(points.map((p) => p.id)).toContain("parking_manquant");
    });

    it("ne se déclenche pas si le parking est requis et présent", () => {
      const points = produirePointsAttention({
        bien: bienTest({ parking: true }),
        acquereur: acquereurTest({ necessiteParking: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("parking_manquant");
    });
  });

  describe("exterieur_manquant", () => {
    it("ne se déclenche pas si l'extérieur n'est pas requis", () => {
      const points = produirePointsAttention({
        bien: bienTest({ exterieur: "aucun" }),
        acquereur: acquereurTest({ necessiteExterieur: false }),
      });
      expect(points.map((p) => p.id)).not.toContain("exterieur_manquant");
    });

    it("ne se déclenche pas si l'extérieur est inconnu", () => {
      const points = produirePointsAttention({
        bien: bienTest({ exterieur: undefined }),
        acquereur: acquereurTest({ necessiteExterieur: true }),
      });
      expect(points.map((p) => p.id)).not.toContain("exterieur_manquant");
    });

    it("se déclenche si l'extérieur est requis et absent (aucun)", () => {
      const points = produirePointsAttention({
        bien: bienTest({ exterieur: "aucun" }),
        acquereur: acquereurTest({ necessiteExterieur: true }),
      });
      expect(points.map((p) => p.id)).toContain("exterieur_manquant");
    });

    it("ne se déclenche pas si l'extérieur est requis et présent (balcon/terrasse/jardin)", () => {
      for (const exterieur of ["balcon", "terrasse", "jardin"] as const) {
        const points = produirePointsAttention({
          bien: bienTest({ exterieur }),
          acquereur: acquereurTest({ necessiteExterieur: true }),
        });
        expect(points.map((p) => p.id)).not.toContain("exterieur_manquant");
      }
    });
  });

  it("cumule plusieurs points d'attention indépendants sans interférence", () => {
    const points = produirePointsAttention({
      bien: bienTest({ prix: 500000, pieces: 1, surface: 10, parking: false, exterieur: "aucun" }),
      acquereur: acquereurTest({
        budgetMax: 400000,
        piecesMin: 3,
        surfaceMin: 50,
        necessiteParking: true,
        necessiteExterieur: true,
      }),
    });
    expect(points.map((p) => p.id).sort()).toEqual(
      [
        "exterieur_manquant",
        "parking_manquant",
        "pieces_insuffisantes",
        "prix_superieur_budget_max",
        "surface_insuffisante",
      ].sort()
    );
  });

  it("ne produit aucun point d'attention pour un couple bien/acquéreur sans aucun signal", () => {
    const points = produirePointsAttention({ bien: bienTest(), acquereur: acquereurTest() });
    expect(points).toEqual([]);
  });
});
