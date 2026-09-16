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

// ADR-060 §7 — quatre états, bornes INCLUSIVES, ordre fixé.
describe("deriverStatutMandat — ADR-060", () => {
  it("A. prise d'effet demain → a_venir", () => {
    expect(deriverStatutMandat({ ...BASE, dateDebut: "2026-06-02" }, "2026-06-01")).toBe("a_venir");
  });
  it("B. prise d'effet aujourd'hui → actif", () => {
    expect(deriverStatutMandat({ ...BASE, dateDebut: "2026-06-01" }, "2026-06-01")).toBe("actif");
  });
  it("C. terme aujourd'hui → actif (dernier jour couvert)", () => {
    expect(deriverStatutMandat({ ...BASE, dateFin: "2026-06-01" }, "2026-06-01")).toBe("actif");
  });
  it("D. terme hier → expire", () => {
    expect(deriverStatutMandat({ ...BASE, dateFin: "2026-05-31" }, "2026-06-01")).toBe("expire");
  });
  it("E. résilié aujourd'hui → resilie", () => {
    expect(deriverStatutMandat({ ...BASE, resilieLe: "2026-06-01" }, "2026-06-01")).toBe("resilie");
  });
  it("F. la résiliation l'emporte sur un terme déjà passé", () => {
    expect(deriverStatutMandat({ ...BASE, dateFin: "2026-03-01", resilieLe: "2026-02-01" }, "2026-06-01")).toBe("resilie");
  });
  it("G. prise d'effet future ET résiliation passée → resilie (la résiliation est lue en premier)", () => {
    expect(deriverStatutMandat({ ...BASE, dateDebut: "2026-09-01", resilieLe: "2026-05-01" }, "2026-06-01")).toBe("resilie");
  });
  it("les champs hors dates n'entrent pas dans le statut", () => {
    const complet: Mandat = { ...BASE, type: "exclusif", numero: "X", remplaceMandatId: "m0" };
    expect(deriverStatutMandat(complet, "2026-06-01")).toBe("actif");
  });
});
