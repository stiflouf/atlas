import { describe, expect, it } from "vitest";
import { calculerOccurrencesInactiviteDues } from "./calculOccurrencesInactivite";

const FUSEAU = "Europe/Paris";

describe("calculerOccurrencesInactiviteDues", () => {
  it("seuil non atteint : aucune occurrence", () => {
    const maintenant = new Date("2026-08-14T10:00:00Z");
    const candidats = [{ prospectVendeurId: "p1", dernierContactLe: "2026-08-10T10:00:00Z", creeLe: "2026-08-01T10:00:00Z" }];
    expect(calculerOccurrencesInactiviteDues(maintenant, 7, candidats, FUSEAU)).toEqual([]);
  });

  it("seuil exactement atteint : une occurrence (>=, jamais ===)", () => {
    const maintenant = new Date("2026-08-08T10:00:00Z");
    const dernierContactLe = "2026-08-01T10:00:00Z";
    const candidats = [{ prospectVendeurId: "p1", dernierContactLe, creeLe: "2026-07-01T10:00:00Z" }];
    expect(calculerOccurrencesInactiviteDues(maintenant, 7, candidats, FUSEAU)).toEqual([
      { prospectVendeurId: "p1", ancreCycle: dernierContactLe },
    ]);
  });

  it("seuil dépassé depuis plusieurs jours : une occurrence quand même (scan en retard)", () => {
    const maintenant = new Date("2026-08-20T10:00:00Z");
    const dernierContactLe = "2026-08-01T10:00:00Z";
    const candidats = [{ prospectVendeurId: "p1", dernierContactLe, creeLe: "2026-07-01T10:00:00Z" }];
    expect(calculerOccurrencesInactiviteDues(maintenant, 7, candidats, FUSEAU)).toEqual([
      { prospectVendeurId: "p1", ancreCycle: dernierContactLe },
    ]);
  });

  it("ancre = dernierContactLe quand un contact a déjà eu lieu", () => {
    const maintenant = new Date("2026-08-20T10:00:00Z");
    const candidats = [
      { prospectVendeurId: "p1", dernierContactLe: "2026-08-01T10:00:00Z", creeLe: "2026-01-01T10:00:00Z" },
    ];
    expect(calculerOccurrencesInactiviteDues(maintenant, 7, candidats, FUSEAU)).toEqual([
      { prospectVendeurId: "p1", ancreCycle: "2026-08-01T10:00:00Z" },
    ]);
  });

  it("ancre = creeLe quand aucun contact n'a jamais eu lieu (repli validé, ADR-033 point 2)", () => {
    const maintenant = new Date("2026-08-20T10:00:00Z");
    const candidats = [{ prospectVendeurId: "p1", dernierContactLe: undefined, creeLe: "2026-08-01T10:00:00Z" }];
    expect(calculerOccurrencesInactiviteDues(maintenant, 7, candidats, FUSEAU)).toEqual([
      { prospectVendeurId: "p1", ancreCycle: "2026-08-01T10:00:00Z" },
    ]);
  });

  it("plusieurs candidats : seuls ceux dont le seuil est atteint sont retournés", () => {
    const maintenant = new Date("2026-08-20T10:00:00Z");
    const candidats = [
      { prospectVendeurId: "atteint", dernierContactLe: "2026-08-01T10:00:00Z", creeLe: "2026-01-01T10:00:00Z" },
      { prospectVendeurId: "non-atteint", dernierContactLe: "2026-08-18T10:00:00Z", creeLe: "2026-01-01T10:00:00Z" },
    ];
    expect(calculerOccurrencesInactiviteDues(maintenant, 7, candidats, FUSEAU)).toEqual([
      { prospectVendeurId: "atteint", ancreCycle: "2026-08-01T10:00:00Z" },
    ]);
  });
});
