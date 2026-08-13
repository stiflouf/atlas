import { describe, expect, it } from "vitest";
import { deriverStatutProspectVendeur } from "./prospectVendeur";
import type { ProspectVendeur } from "./prospectVendeur";

function prospectTest(surcharge: Partial<ProspectVendeur> = {}): ProspectVendeur {
  return {
    id: "prospect-test",
    nom: "Dupont",
    creeLe: "2026-01-01T00:00:00.000Z",
    modifieLe: "2026-01-01T00:00:00.000Z",
    ...surcharge,
  };
}

describe("deriverStatutProspectVendeur", () => {
  it("retourne 'prospect' sans aucun jalon", () => {
    expect(deriverStatutProspectVendeur(prospectTest())).toBe("prospect");
  });

  it("retourne 'qualification' quand qualifieLe seul est posé", () => {
    expect(deriverStatutProspectVendeur(prospectTest({ qualifieLe: "2026-01-02T00:00:00.000Z" }))).toBe("qualification");
  });

  it("un rendez-vous PRÉVU seul ne fait jamais avancer le statut (correction n° 3)", () => {
    const prospect = prospectTest({
      qualifieLe: "2026-01-02T00:00:00.000Z",
      rdvEstimationPrevuLe: "2026-01-10T14:00:00.000Z",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("qualification");
  });

  it("un rendez-vous RÉALISÉ fait avancer le statut vers 'rendez_vous'", () => {
    const prospect = prospectTest({
      qualifieLe: "2026-01-02T00:00:00.000Z",
      rdvEstimationRealiseLe: "2026-01-10T14:00:00.000Z",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("rendez_vous");
  });

  it("une estimation chiffrée l'emporte sur un rendez-vous réalisé (ordre d'affichage corrigé)", () => {
    const prospect = prospectTest({
      rdvEstimationRealiseLe: "2026-01-10T14:00:00.000Z",
      estimationProposeeLe: "2026-01-12",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("estimation");
  });

  it("une estimation chiffrée AVANT tout rendez-vous réalisé affiche déjà 'estimation' (aucun ordre de saisie imposé)", () => {
    const prospect = prospectTest({ estimationProposeeLe: "2026-01-12" });
    expect(deriverStatutProspectVendeur(prospect)).toBe("estimation");
  });

  it("mandat_propose l'emporte sur tous les jalons antérieurs", () => {
    const prospect = prospectTest({
      qualifieLe: "2026-01-02T00:00:00.000Z",
      estimationProposeeLe: "2026-01-12",
      rdvEstimationRealiseLe: "2026-01-10T14:00:00.000Z",
      mandatProposeLe: "2026-01-15T00:00:00.000Z",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("mandat_propose");
  });

  it("mandat_signe est terminal, l'emporte sur tout le reste", () => {
    const prospect = prospectTest({
      qualifieLe: "2026-01-02T00:00:00.000Z",
      mandatProposeLe: "2026-01-15T00:00:00.000Z",
      mandatSigneLe: "2026-01-20T00:00:00.000Z",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("mandat_signe");
  });

  it("perdu est prioritaire depuis n'importe quel état, y compris après mandat_propose", () => {
    const prospect = prospectTest({
      mandatProposeLe: "2026-01-15T00:00:00.000Z",
      datePerte: "2026-01-20",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("perdu");
  });

  it("perdu l'emporte même sur mandat_signe (garde applicative empêchant normalement cette combinaison, mais la dérivation reste sûre)", () => {
    const prospect = prospectTest({
      mandatSigneLe: "2026-01-20T00:00:00.000Z",
      datePerte: "2026-01-25",
    });
    expect(deriverStatutProspectVendeur(prospect)).toBe("perdu");
  });
});
