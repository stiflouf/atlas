import { describe, expect, it } from "vitest";
import { parseProspectVendeurFormData, parseSignatureMandatFormData } from "./prospectVendeurFormulaire";

function formData(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("parseProspectVendeurFormData", () => {
  it("rejette un nom vide", () => {
    expect(() => parseProspectVendeurFormData(formData({ nom: "" }))).toThrow("nom");
  });

  it("accepte un prospect sans prénom, sans email, sans téléphone (correction n° 4)", () => {
    const resultat = parseProspectVendeurFormData(formData({ nom: "Dupont" }));
    expect(resultat).toMatchObject({ nom: "Dupont", prenom: undefined, email: undefined, telephone: undefined });
  });

  it("rejette une origine de lead invalide", () => {
    expect(() => parseProspectVendeurFormData(formData({ nom: "Dupont", origineLead: "porte-a-porte" }))).toThrow(
      "Origine du lead invalide."
    );
  });

  it("accepte une origine de lead absente (non déterminée)", () => {
    const resultat = parseProspectVendeurFormData(formData({ nom: "Dupont" }));
    expect(resultat.origineLead).toBeUndefined();
  });

  it("rejette un type de bien invalide", () => {
    expect(() => parseProspectVendeurFormData(formData({ nom: "Dupont", typeBien: "chateau" }))).toThrow(
      "Type de bien invalide."
    );
  });

  it("sépare adresse précise et secteur approximatif sans jamais les fusionner", () => {
    const resultat = parseProspectVendeurFormData(
      formData({ nom: "Dupont", adresseBienPotentiel: "12 rue de la Paix", secteurBienPotentiel: "Quartier centre-ville" })
    );
    expect(resultat.adresseBienPotentiel).toBe("12 rue de la Paix");
    expect(resultat.secteurBienPotentiel).toBe("Quartier centre-ville");
  });
});

describe("parseSignatureMandatFormData — correction n° 6, aucune valeur inventée", () => {
  const champsBienComplets = {
    reference: "ATL-2026-042",
    titre: "Maison 5 pièces",
    type: "maison",
    adresse: "12 rue de la Paix",
    ville: "Paris",
    codePostal: "75002",
    surface: "120",
    pieces: "5",
    prix: "500000",
    statutMandat: "actif",
    dateMandat: "2026-09-01",
  };

  it("accepte un formulaire complet", () => {
    const resultat = parseSignatureMandatFormData(formData(champsBienComplets));
    expect(resultat.adresse).toBe("12 rue de la Paix");
    expect(resultat.reference).toBe("ATL-2026-042");
  });

  it("rejette une adresse vide même si un secteur approximatif existe par ailleurs (jamais une substitution automatique)", () => {
    const fd = formData({ ...champsBienComplets, adresse: "" });
    expect(() => parseSignatureMandatFormData(fd)).toThrow("adresse précise");
  });

  it("rejette une référence vide", () => {
    const fd = formData({ ...champsBienComplets, reference: "" });
    expect(() => parseSignatureMandatFormData(fd)).toThrow("référence");
  });

  it("rejette un titre vide", () => {
    const fd = formData({ ...champsBienComplets, titre: "" });
    expect(() => parseSignatureMandatFormData(fd)).toThrow("titre");
  });

  it("rejette une ville vide", () => {
    const fd = formData({ ...champsBienComplets, ville: "" });
    expect(() => parseSignatureMandatFormData(fd)).toThrow("ville");
  });

  it("rejette un code postal vide", () => {
    const fd = formData({ ...champsBienComplets, codePostal: "" });
    expect(() => parseSignatureMandatFormData(fd)).toThrow("code postal");
  });

  it("rejette une surface manquante (héritée de parseBienFormData)", () => {
    const fd = formData({ ...champsBienComplets, surface: "" });
    expect(() => parseSignatureMandatFormData(fd)).toThrow("Surface invalide");
  });
});
