import { describe, expect, it } from "vitest";
import { lienRetourFicheVisite, retourVisiteValide, routeVisiteAvecRetour } from "./retourVisite";

// VISIT_NATIVE_ENTRY_V1 — `retour` est un enum fermé : jamais un chemin relu depuis la requête.
describe("retourVisiteValide", () => {
  it("n'accepte que bien et acquereur", () => {
    expect(retourVisiteValide("bien")).toBe("bien");
    expect(retourVisiteValide("acquereur")).toBe("acquereur");
  });

  it("refuse toute autre valeur, y compris une URL ou un chemin", () => {
    for (const valeur of ["", "/", "https://evil.example", "//evil.example", "/biens/x", "today", undefined]) {
      expect(retourVisiteValide(valeur)).toBeUndefined();
    }
  });
});

describe("routeVisiteAvecRetour / lienRetourFicheVisite", () => {
  const visite = { bienId: "b1", acquereurId: "a1" };

  it("route canonique /visites/{id}, jamais /preparer", () => {
    expect(routeVisiteAvecRetour("v1", undefined)).toBe("/visites/v1");
    expect(routeVisiteAvecRetour("v1", "bien")).toBe("/visites/v1?retour=bien");
  });

  it("lien retour construit depuis la Visite résolue, jamais depuis la requête", () => {
    expect(lienRetourFicheVisite("bien", visite)).toEqual({ href: "/biens/b1?onglet=visites", label: "Retour au bien" });
    expect(lienRetourFicheVisite("acquereur", visite)).toEqual({ href: "/clients/a1", label: "Retour à l'acquéreur" });
    expect(lienRetourFicheVisite(undefined, visite)).toEqual({ href: "/", label: "Aujourd'hui" });
  });
});
