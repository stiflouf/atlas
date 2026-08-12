import { describe, expect, it } from "vitest";
import type { Bien } from "@/types/bien";
import type { Compromis } from "@/types/compromis";
import { deriverStatutCommercial } from "./statutCommercialBien";

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
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

function compromisTest(surcharge: Partial<Compromis> = {}): Compromis {
  return {
    id: "compromis-test",
    bienId: "bien-test",
    acquereurId: "acquereur-test",
    prixConvenu: 300000,
    dateSignature: "2026-08-01",
    statut: "en_cours",
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("deriverStatutCommercial", () => {
  it("retourne en_commercialisation par défaut, sans jalon ni compromis", () => {
    expect(deriverStatutCommercial(bienTest())).toBe("en_commercialisation");
  });

  it("retourne offre_en_cours quand offreEnCoursLe est posé", () => {
    const bien = bienTest({ offreEnCoursLe: "2026-08-01T10:00:00.000Z" });
    expect(deriverStatutCommercial(bien)).toBe("offre_en_cours");
  });

  it("retourne compromis_signe quand compromisSigneLe est posé", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    expect(deriverStatutCommercial(bien)).toBe("compromis_signe");
  });

  it("retourne vendu quand un compromis realise avec dateActeReelle existe, prioritaire sur compromis_signe", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "realise", dateActeReelle: "2026-10-08" })];

    expect(deriverStatutCommercial(bien, compromis)).toBe("vendu");
  });

  it("ne retourne jamais vendu si le compromis realise n'a pas de dateActeReelle (garde défensive)", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [compromisTest({ statut: "realise", dateActeReelle: undefined })];

    expect(deriverStatutCommercial(bien, compromis)).toBe("compromis_signe");
  });

  it("ignore les compromis en_cours ou annule pour la dérivation de vendu", () => {
    const bien = bienTest({ compromisSigneLe: "2026-08-05T10:00:00.000Z" });
    const compromis = [
      compromisTest({ id: "c1", statut: "en_cours" }),
      compromisTest({ id: "c2", statut: "annule", dateActeReelle: undefined }),
    ];

    expect(deriverStatutCommercial(bien, compromis)).toBe("compromis_signe");
  });
});
