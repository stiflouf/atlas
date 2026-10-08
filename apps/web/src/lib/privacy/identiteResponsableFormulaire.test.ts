import { describe, expect, it } from "vitest";
import { ErreurSaisie } from "@/lib/formulaires/etatFormulaire";
import { parseIdentiteResponsableFormData } from "./identiteResponsableFormulaire";

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) formData.set(cle, valeur);
  return formData;
}

describe("T6 — SIREN", () => {
  it("un SIREN de 9 chiffres est accepté", () => {
    expect(parseIdentiteResponsableFormData(formulaire({ controllerSiren: "123456789" })).controllerSiren).toBe("123456789");
  });

  it("les espaces et points de saisie sont normalisés, jamais rejetés", () => {
    expect(parseIdentiteResponsableFormData(formulaire({ controllerSiren: "123 456 789" })).controllerSiren).toBe("123456789");
  });

  it("un SIREN trop court, trop long ou non numérique est refusé", () => {
    for (const invalide of ["12345678", "1234567890", "12345678A", "abcdefghi", "123-456-789"]) {
      expect(() => parseIdentiteResponsableFormData(formulaire({ controllerSiren: invalide })), invalide).toThrow(ErreurSaisie);
    }
  });

  it("un SIREN absent reste null, et n'est pas une erreur", () => {
    expect(parseIdentiteResponsableFormData(formulaire({ controllerSiren: "" })).controllerSiren).toBeNull();
    expect(parseIdentiteResponsableFormData(formulaire({})).controllerSiren).toBeNull();
  });
});

describe("T7 — adresses email", () => {
  it("une adresse d'exercice des droits valide est conservée", () => {
    expect(parseIdentiteResponsableFormData(formulaire({ privacyRightsEmail: "droits@exemple.test" })).privacyRightsEmail).toBe(
      "droits@exemple.test"
    );
  });

  it("une adresse d'exercice des droits invalide est refusée", () => {
    for (const invalide of ["pas-un-email", "a@b", "a b@exemple.test", "@exemple.test", "droits@", "droits@exemple"]) {
      expect(() => parseIdentiteResponsableFormData(formulaire({ privacyRightsEmail: invalide })), invalide).toThrow(ErreurSaisie);
    }
  });

  it("le message de refus nomme le champ concerné", () => {
    expect(() => parseIdentiteResponsableFormData(formulaire({ privacyRightsEmail: "x" }))).toThrow(
      /adresse d.exercice des droits/i
    );
    expect(() => parseIdentiteResponsableFormData(formulaire({ dpoEmail: "x" }))).toThrow(/délégué/i);
  });

  it("une adresse de délégué invalide est refusée, mais son absence est permise", () => {
    expect(() => parseIdentiteResponsableFormData(formulaire({ dpoEmail: "pas-un-email" }))).toThrow(ErreurSaisie);
    expect(parseIdentiteResponsableFormData(formulaire({ dpoEmail: "" })).dpoEmail).toBeNull();
  });
});

describe("code pays", () => {
  it("deux lettres sont acceptées et mises en majuscules", () => {
    expect(parseIdentiteResponsableFormData(formulaire({ controllerCountryCode: "fr" })).controllerCountryCode).toBe("FR");
  });

  it("une longueur différente de deux est refusée", () => {
    for (const invalide of ["F", "FRA", "F1", "12"]) {
      expect(() => parseIdentiteResponsableFormData(formulaire({ controllerCountryCode: invalide })), invalide).toThrow(ErreurSaisie);
    }
  });
});

describe("frontière des champs vides", () => {
  it("un champ vide devient null, jamais une chaîne vide", () => {
    const champs = parseIdentiteResponsableFormData(formulaire({ controllerLegalName: "", controllerCity: "   " }));
    expect(champs.controllerLegalName).toBeNull();
    expect(champs.controllerCity).toBeNull();
  });

  it("les valeurs sont nettoyées de leurs espaces de bord", () => {
    expect(parseIdentiteResponsableFormData(formulaire({ controllerLegalName: "  Camille Dupré  " })).controllerLegalName).toBe(
      "Camille Dupré"
    );
  });

  it("une saisie entièrement partielle est acceptée : la complétude n'est pas une condition d'enregistrement", () => {
    // Refuser une saisie partielle forcerait à tout réunir d'un coup, ou à inventer une valeur.
    expect(() => parseIdentiteResponsableFormData(formulaire({ controllerLegalName: "Camille Dupré" }))).not.toThrow();
  });

  it("aucun champ n'est obligatoire à l'enregistrement", () => {
    expect(() => parseIdentiteResponsableFormData(formulaire({}))).not.toThrow();
  });
});
