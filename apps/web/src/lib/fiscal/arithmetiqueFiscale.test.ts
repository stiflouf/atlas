import { describe, expect, it } from "vitest";
import {
  appliquerTauxPointsBase,
  estBissextile,
  joursDansAnnee,
  joursInclusEntre,
  prorataJours,
} from "./arithmetiqueFiscale";

describe("appliquerTauxPointsBase — arithmétique entière exclusivement", () => {
  it("calcule un taux qui tombe rond sans arrondi", () => {
    // 10 000,00 € à 25,6 % = 2 560,00 €
    expect(appliquerTauxPointsBase(1000000, 2560)).toBe(256000);
  });

  it("calcule un taux de 0,2 % (CFP) sur un montant réaliste", () => {
    // 1 248 736 centimes à 0,2 % (20 points de base) = 2 497,472 centimes -> arrondi
    expect(appliquerTauxPointsBase(1248736, 20)).toBe(2497); // reste 0.472 < 0.5 -> arrondi en dessous
  });

  it("arrondit exactement à la moitié vers le haut", () => {
    // 1 centime à 50 % (5000 points de base) = 0,5 centime -> arrondi à 1
    expect(appliquerTauxPointsBase(1, 5000)).toBe(1);
    // 3 centimes à 50 % = 1,5 centime -> arrondi à 2
    expect(appliquerTauxPointsBase(3, 5000)).toBe(2);
  });

  it("n'arrondit pas quand le reste est strictement inférieur à la moitié", () => {
    // 1 centime à 49 % (4900 points de base) = 0,49 centime -> arrondi à 0
    expect(appliquerTauxPointsBase(1, 4900)).toBe(0);
  });

  it("gère un montant nul", () => {
    expect(appliquerTauxPointsBase(0, 2560)).toBe(0);
  });

  it("reste exact sur de gros montants (aucune perte de précision BigInt)", () => {
    // 999 999 999 centimes (~10M€) à 25,6 %
    const numerateurAttendu = BigInt(999999999) * BigInt(2560);
    const quotient = numerateurAttendu / BigInt(10000);
    const reste = numerateurAttendu % BigInt(10000);
    const attendu = Number(reste * BigInt(2) >= BigInt(10000) ? quotient + BigInt(1) : quotient);
    expect(appliquerTauxPointsBase(999999999, 2560)).toBe(attendu);
  });
});

describe("prorataJours — prorata entier, jamais une division JS number", () => {
  it("calcule un prorata exact quand jours/joursAnnee tombe rond", () => {
    // plafond de 36 500 centimes sur 365 jours, activité 100 jours -> 10 000 centimes exactement
    expect(prorataJours(36500, 100, 365)).toBe(10000);
  });

  it("arrondit un prorata non exact à la moitié vers le haut", () => {
    const plafond = 8360000; // plafond micro-BNC 2026
    const jours = 183;
    const anneeJours = 365;
    const numerateur = BigInt(plafond) * BigInt(jours);
    const quotient = numerateur / BigInt(anneeJours);
    const reste = numerateur % BigInt(anneeJours);
    const attendu = Number(reste * BigInt(2) >= BigInt(anneeJours) ? quotient + BigInt(1) : quotient);
    expect(prorataJours(plafond, jours, anneeJours)).toBe(attendu);
  });

  it("un prorata sur l'année entière restitue le montant plein", () => {
    expect(prorataJours(8360000, 365, 365)).toBe(8360000);
  });
});

describe("estBissextile / joursDansAnnee", () => {
  it.each([
    [2024, true],
    [2023, false],
    [2000, true],
    [1900, false],
    [2026, false],
  ])("%i bissextile = %s", (annee, attendu) => {
    expect(estBissextile(annee)).toBe(attendu);
  });

  it("joursDansAnnee retourne 366 ou 365 selon le caractère bissextile", () => {
    expect(joursDansAnnee(2024)).toBe(366);
    expect(joursDansAnnee(2026)).toBe(365);
  });
});

describe("joursInclusEntre", () => {
  it("une seule journée retourne 1", () => {
    expect(joursInclusEntre("2026-03-01", "2026-03-01")).toBe(1);
  });

  it("une année civile complète non bissextile retourne 365", () => {
    expect(joursInclusEntre("2026-01-01", "2026-12-31")).toBe(365);
  });

  it("une année civile complète bissextile retourne 366", () => {
    expect(joursInclusEntre("2024-01-01", "2024-12-31")).toBe(366);
  });

  it("traverse un changement de mois/année sans erreur de fuseau", () => {
    expect(joursInclusEntre("2026-12-15", "2027-01-15")).toBe(32);
  });
});
