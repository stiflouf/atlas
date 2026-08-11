import { describe, expect, it } from "vitest";
import { parseAcquereurFormData, parseNombreOptionnel, parseTriEtat } from "./acquereurFormulaire";

function formDataValide(surcharge: Record<string, string> = {}): FormData {
  const champs: Record<string, string> = {
    prenom: "Sophie",
    nom: "Dubois",
    email: "sophie@example.com",
    telephone: "0600000000",
    budgetMin: "200000",
    budgetMax: "400000",
    stadeProjet: "decouverte",
    datePremiereContact: "2026-01-01",
    criteres: "3 pièces minimum\nLumineux",
    notes: "Contact initial",
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
  });
});

describe("parseNombreOptionnel", () => {
  it("vide -> undefined, sinon le nombre", () => {
    expect(parseNombreOptionnel("")).toBeUndefined();
    expect(parseNombreOptionnel(null)).toBeUndefined();
    expect(parseNombreOptionnel("3")).toBe(3);
  });
});

describe("parseAcquereurFormData", () => {
  it("parse un formulaire valide, champs optionnels absents -> undefined", () => {
    const acquereur = parseAcquereurFormData(formDataValide());
    expect(acquereur.prenom).toBe("Sophie");
    expect(acquereur.criteres).toEqual(["3 pièces minimum", "Lumineux"]);
    expect(acquereur.piecesMin).toBeUndefined();
    expect(acquereur.accessibiliteRequise).toBeUndefined();
  });

  it("rejette un budget minimum négatif", () => {
    expect(() => parseAcquereurFormData(formDataValide({ budgetMin: "-1" }))).toThrow(/Budget minimum invalide/);
  });

  it("rejette budgetMin > budgetMax", () => {
    expect(() => parseAcquereurFormData(formDataValide({ budgetMin: "500000", budgetMax: "400000" }))).toThrow(
      /budget minimum ne peut pas/
    );
  });

  it("rejette des pièces/surface minimum invalides quand renseignées", () => {
    expect(() => parseAcquereurFormData(formDataValide({ piecesMin: "0" }))).toThrow(/Pièces minimum invalide/);
    expect(() => parseAcquereurFormData(formDataValide({ surfaceMin: "0" }))).toThrow(/Surface minimum invalide/);
  });

  it("préserve le tri-état pour accessibilite/parking/exterieur", () => {
    const acquereur = parseAcquereurFormData(
      formDataValide({ accessibiliteRequise: "oui", necessiteParking: "non" })
    );
    expect(acquereur.accessibiliteRequise).toBe(true);
    expect(acquereur.necessiteParking).toBe(false);
    expect(acquereur.necessiteExterieur).toBeUndefined();
  });
});
