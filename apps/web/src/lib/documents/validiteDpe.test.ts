import { describe, expect, it } from "vitest";
import { DUREE_VALIDITE_DPE_ANNEES, dateFinValiditeTheoriqueDpe } from "./validiteDpe";

describe("dateFinValiditeTheoriqueDpe — 10 ans moins 1 jour (CCH art. D126-19)", () => {
  it("un DPE établi le 01/09/2026 est théoriquement valable jusqu'au 31/08/2036 inclus", () => {
    expect(dateFinValiditeTheoriqueDpe("2026-09-01")).toBe("2036-08-31");
  });

  it("la borne est inclusive : jamais le même quantième 10 ans plus tard", () => {
    expect(dateFinValiditeTheoriqueDpe("2026-01-01")).toBe("2035-12-31");
    expect(dateFinValiditeTheoriqueDpe("2025-07-15")).toBe("2035-07-14");
  });

  it("29 février : l'échéance retombe sur le 28 février, jamais une date inexistante", () => {
    expect(dateFinValiditeTheoriqueDpe("2024-02-29")).toBe("2034-02-28");
  });

  it("retourne null tant que la date d'établissement n'est pas une date civile complète", () => {
    expect(dateFinValiditeTheoriqueDpe("")).toBeNull();
    expect(dateFinValiditeTheoriqueDpe("2026-09")).toBeNull();
    expect(dateFinValiditeTheoriqueDpe("01/09/2026")).toBeNull();
  });

  it("la durée reste 10 ans — aucun autre diagnostic n'est modélisé ici", () => {
    expect(DUREE_VALIDITE_DPE_ANNEES).toBe(10);
  });
});
