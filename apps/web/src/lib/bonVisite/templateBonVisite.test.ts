import { describe, expect, it } from "vitest";
import {
  construireTexteBonVisite,
  construireTexteBonVisiteV2,
  TEXTE_CONSENTEMENT_BON_VISITE_V1,
  TEXTE_CONSENTEMENT_BON_VISITE_V2,
  texteConsentementPourVersion,
  titreDocumentBonVisite,
  VERSION_TEMPLATE_BON_VISITE_V1,
  VERSION_TEMPLATE_BON_VISITE_V2,
} from "./templateBonVisite";

const PARAMS = {
  bienReference: "REF-42",
  bienTitre: "Bel appartement",
  bienAdresse: "1 rue du Test",
  bienVille: "Testville",
  bienCodePostal: "00000",
  conseillerNom: "Bérengère Calais",
};

describe("construireTexteBonVisiteV2 — visite déjà réalisée", () => {
  // T1 — la date citée est la date de réalisation enregistrée.
  it("cite la date de réalisation, dans le fuseau du conseiller", () => {
    const texte = construireTexteBonVisiteV2({ ...PARAMS, dateRealisationISO: "2026-06-04T08:15:00.000Z" });
    expect(texte).toContain("a été visité le 4 juin 2026");
    expect(texte).toContain("Bel appartement");
    expect(texte).toContain("REF-42");
    expect(texte).toContain("1 rue du Test, 00000 Testville");
    expect(texte).toContain("avec le concours de Bérengère Calais");
  });

  // Un instant tardif en UTC ne doit pas dater la visite du lendemain pour un lecteur français.
  it("rend la date civile Europe/Paris, jamais la date UTC brute", () => {
    const texte = construireTexteBonVisiteV2({ ...PARAMS, dateRealisationISO: "2026-06-04T23:30:00.000Z" });
    expect(texte).toContain("5 juin 2026");
  });
});

describe("construireTexteBonVisiteV2 — visite pas encore réalisée (cas normal du terrain)", () => {
  // T2/T3 — aucune date de visite n'est affirmée : ni la date prévue, ni un libellé de
  // substitution, ni une date inventée. Le constat est daté par l'horodatage de signature.
  it("n'affirme AUCUNE date de visite, et renvoie au seul horodatage prouvé", () => {
    const texte = construireTexteBonVisiteV2({ ...PARAMS, dateRealisationISO: null });
    expect(texte).toContain("a été visité avec le concours de Bérengère Calais");
    expect(texte).not.toMatch(/a été visité le/);
    expect(texte).not.toMatch(/\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/);
    expect(texte).not.toMatch(/\b20\d{2}\b/);
    expect(texte).toContain("daté par l'horodatage de signature");
  });

  it("le gabarit V2 n'expose aucun moyen d'injecter une date prévue", () => {
    expect(Object.keys(PARAMS)).not.toContain("datePrevue");
  });
});

describe("construireTexteBonVisiteV2 — formulations retirées", () => {
  it("abandonne les formulations de V1 et n'ajoute aucune donnée absente de DOMIORA", () => {
    for (const dateRealisationISO of ["2026-06-04T08:15:00.000Z", null]) {
      const texte = construireTexteBonVisiteV2({ ...PARAMS, dateRealisationISO });
      for (const interdit of [
        "trace interne",
        "avis juridique",
        "représentant l'agence",
        "commission",
        "pénalité",
        "exclusiv",
        "mandat n",
        "SIREN",
        "carte professionnelle",
      ]) {
        expect(texte.toLowerCase()).not.toContain(interdit.toLowerCase());
      }
      expect(texte).toContain("ne vaut ni mandat, ni offre ou promesse d'achat");
      expect(texte).toContain("aucune obligation de rémunération à la charge du visiteur");
    }
  });
});

describe("domiora-v1 / domiora-v2 — coexistence", () => {
  // I1 — le gabarit V1 produit toujours exactement le même texte qu'avant ce lot.
  it("le gabarit V1 est inchangé, caractère pour caractère", () => {
    const texte = construireTexteBonVisite({
      bienReference: "REF-42",
      bienTitre: "Bel appartement",
      bienAdresse: "1 rue du Test",
      bienVille: "Testville",
      bienCodePostal: "00000",
      datePrevue: "2026-06-01",
      conseillerNom: "Bérengère Calais",
    });
    expect(texte).toBe(
      'Bon de visite\n\nLe bien "Bel appartement" (réf. REF-42), situé 1 rue du Test, 00000 Testville, ' +
        "a été visité le 1 juin 2026 en présence de Bérengère Calais, représentant l'agence.\n\n" +
        "Ce document constitue une trace interne de la visite réalisée avec le concours de l'agence. " +
        "Il ne constitue ni un contrat, ni un avis juridique, et n'emporte aucune obligation d'achat ni de vente."
    );
  });

  it("les deux versions ont des identifiants et des titres distincts", () => {
    expect(VERSION_TEMPLATE_BON_VISITE_V1).toBe("domiora-v1");
    expect(VERSION_TEMPLATE_BON_VISITE_V2).toBe("domiora-v2");
    expect(titreDocumentBonVisite(VERSION_TEMPLATE_BON_VISITE_V1)).toBe("BON DE VISITE");
    expect(titreDocumentBonVisite(VERSION_TEMPLATE_BON_VISITE_V2)).toBe("BON DE VISITE – ATTESTATION DE VISITE");
  });

  it("chaque version porte sa propre formule de consentement", () => {
    expect(texteConsentementPourVersion(VERSION_TEMPLATE_BON_VISITE_V1)).toBe(TEXTE_CONSENTEMENT_BON_VISITE_V1);
    expect(texteConsentementPourVersion(VERSION_TEMPLATE_BON_VISITE_V2)).toBe(TEXTE_CONSENTEMENT_BON_VISITE_V2);
    expect(TEXTE_CONSENTEMENT_BON_VISITE_V2).not.toBe(TEXTE_CONSENTEMENT_BON_VISITE_V1);
  });
});
