import { describe, expect, it } from "vitest";
import { deriverStatutMandat, type Mandat } from "./mandat";

// ADR-055 invariant 9 / ADR-014 — le statut d'un mandat est DÉRIVÉ. Ces tests sont la raison pour
// laquelle `date_fin` et `resilie_le` existent : sans eux, « contrat pour une période donnée » ne
// serait pas exprimable.

const BASE: Mandat = { id: "m1", bienId: "b1", dateDebut: "2026-01-01", creeLe: "2026-01-01T00:00:00.000Z" };

describe("deriverStatutMandat", () => {
  it("un mandat sans terme ni résiliation est actif", () => {
    // C'est l'état de tous les mandats créés aujourd'hui : le produit ne saisit pas encore de durée.
    expect(deriverStatutMandat(BASE, "2030-01-01")).toBe("actif");
  });

  it("le jour du terme, le mandat court encore", () => {
    // `date_fin` est le DERNIER jour couvert, pas le premier jour découvert.
    expect(deriverStatutMandat({ ...BASE, dateFin: "2026-04-01" }, "2026-04-01")).toBe("actif");
  });

  it("après le terme, le mandat est expiré", () => {
    expect(deriverStatutMandat({ ...BASE, dateFin: "2026-04-01" }, "2026-04-02")).toBe("expire");
  });

  it("la résiliation l'emporte sur le terme", () => {
    // Elle a mis fin au contrat AVANT son terme : dire « expiré » raconterait une autre histoire.
    const resilie = { ...BASE, dateFin: "2026-12-31", resilieLe: "2026-03-01" };
    expect(deriverStatutMandat(resilie, "2026-06-01")).toBe("resilie");
  });

  it("une résiliation future ne s'applique pas encore", () => {
    expect(deriverStatutMandat({ ...BASE, resilieLe: "2026-09-01" }, "2026-06-01")).toBe("actif");
  });
});
