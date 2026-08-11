import { describe, expect, it } from "vitest";
import { formatDateRelative } from "./temps";

describe("formatDateRelative", () => {
  it("retourne « Demain » pour J+1", () => {
    expect(formatDateRelative("2026-08-12", "2026-08-11")).toBe("Demain");
  });

  it("retourne un format court jour/mois pour une date plus lointaine", () => {
    // 2026-08-18 est un mardi.
    expect(formatDateRelative("2026-08-18", "2026-08-11")).toBe("mar. 18 août");
  });

  it("gère le passage de mois (J+1 en fin de mois)", () => {
    expect(formatDateRelative("2026-09-01", "2026-08-31")).toBe("Demain");
  });
});
