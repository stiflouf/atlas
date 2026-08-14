import { describe, expect, it } from "vitest";
import { parseBienFormData, parseChargeHonoraires, parseExterieur, parseTriEtat } from "./bienFormulaire";

function formDataValide(surcharge: Record<string, string> = {}): FormData {
  const champs: Record<string, string> = {
    reference: "ATL-2026-001",
    titre: "Appartement lumineux",
    type: "appartement",
    adresse: "12 rue de la Paix",
    ville: "Paris",
    codePostal: "75011",
    surface: "50",
    pieces: "3",
    prix: "300000",
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: "Plein sud\nCave",
    description: "Bel appartement",
    ...surcharge,
  };
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("parseTriEtat", () => {
  it("convertit oui/non/vide en true/false/undefined", () => {
    expect(parseTriEtat("oui")).toBe(true);
    expect(parseTriEtat("non")).toBe(false);
    expect(parseTriEtat("")).toBeUndefined();
    expect(parseTriEtat(null)).toBeUndefined();
  });
});

describe("parseExterieur", () => {
  it("accepte les 4 valeurs contrôlées, undefined sinon", () => {
    expect(parseExterieur("balcon")).toBe("balcon");
    expect(parseExterieur("")).toBeUndefined();
    expect(parseExterieur("n'importe quoi")).toBeUndefined();
  });
});

describe("parseChargeHonoraires", () => {
  it("accepte vendeur/acquereur, undefined sinon (V1 volontairement binaire, ADR-029)", () => {
    expect(parseChargeHonoraires("vendeur")).toBe("vendeur");
    expect(parseChargeHonoraires("acquereur")).toBe("acquereur");
    expect(parseChargeHonoraires("")).toBeUndefined();
    expect(parseChargeHonoraires("partagee")).toBeUndefined();
  });
});

describe("parseBienFormData", () => {
  it("parse un formulaire valide, champs optionnels absents -> undefined", () => {
    const bien = parseBienFormData(formDataValide());
    expect(bien.reference).toBe("ATL-2026-001");
    expect(bien.surface).toBe(50);
    expect(bien.caracteristiques).toEqual(["Plein sud", "Cave"]);
    expect(bien.etage).toBeUndefined();
    expect(bien.ascenseur).toBeUndefined();
    expect(bien.exterieur).toBeUndefined();
    expect(bien.nomCopropriete).toBeUndefined();
    expect(bien.chargeHonoraires).toBeUndefined();
  });

  it("parse nomCopropriete/chargeHonoraires quand renseignés", () => {
    const bien = parseBienFormData(formDataValide({ nomCopropriete: "Résidence A", chargeHonoraires: "acquereur" }));
    expect(bien.nomCopropriete).toBe("Résidence A");
    expect(bien.chargeHonoraires).toBe("acquereur");
  });

  it("rejette une surface nulle ou négative", () => {
    expect(() => parseBienFormData(formDataValide({ surface: "0" }))).toThrow(/Surface invalide/);
  });

  it("rejette un nombre de pièces invalide", () => {
    expect(() => parseBienFormData(formDataValide({ pieces: "0" }))).toThrow(/pièces invalide/);
  });

  it("rejette un prix négatif", () => {
    expect(() => parseBienFormData(formDataValide({ prix: "-1" }))).toThrow(/Prix invalide/);
  });

  it("rejette un étage négatif quand renseigné, mais accepte un étage absent", () => {
    expect(() => parseBienFormData(formDataValide({ etage: "-1" }))).toThrow(/Étage invalide/);
    expect(parseBienFormData(formDataValide({ etage: "" })).etage).toBeUndefined();
    expect(parseBienFormData(formDataValide({ etage: "3" })).etage).toBe(3);
  });

  it("préserve le tri-état pour ascenseur/parking/exterieur", () => {
    const bien = parseBienFormData(formDataValide({ ascenseur: "oui", parking: "non", exterieur: "jardin" }));
    expect(bien.ascenseur).toBe(true);
    expect(bien.parking).toBe(false);
    expect(bien.exterieur).toBe("jardin");
  });
});
