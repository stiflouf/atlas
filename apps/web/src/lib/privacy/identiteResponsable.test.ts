import { describe, expect, it } from "vitest";
import {
  CHAMPS_REQUIS_POUR_NOTICE,
  LIBELLES_CHAMPS_REQUIS,
  champsManquantsPourNotice,
  etatIdentiteResponsable,
  identiteResponsablePrete,
  type IdentiteResponsablePartielle,
} from "./identiteResponsable";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — complétude de l'identité du responsable.
//
// L'enjeu de ces tests est la négative : qu'une identité incomplète ne passe JAMAIS pour prête, et
// qu'aucun nom de repli ne vienne combler une absence.

const VIDE: IdentiteResponsablePartielle = {
  controllerLegalName: null,
  controllerLegalForm: null,
  controllerTradeName: null,
  controllerAddressLine1: null,
  controllerAddressLine2: null,
  controllerPostalCode: null,
  controllerCity: null,
  controllerCountryCode: null,
  controllerSiren: null,
  privacyRightsEmail: null,
  dpoName: null,
  dpoEmail: null,
  privacyIdentityModifieLe: null,
};

const MINIMUM: IdentiteResponsablePartielle = {
  ...VIDE,
  controllerLegalName: "Camille Dupré",
  controllerAddressLine1: "12 rue des Lilas",
  controllerPostalCode: "75011",
  controllerCity: "Paris",
  controllerCountryCode: "FR",
  privacyRightsEmail: "droits@exemple.test",
};

describe("T1 / T2 — un workspace sans identité reste valide, et rien n'est inventé", () => {
  it("une identité entièrement vide est lisible sans erreur", () => {
    expect(() => champsManquantsPourNotice(VIDE)).not.toThrow();
    expect(etatIdentiteResponsable(VIDE)).toBe("INCOMPLETE");
  });

  it("aucun champ ne reçoit de valeur de repli", () => {
    for (const valeur of Object.values(VIDE)) {
      expect(valeur).toBeNull();
    }
  });

  it("aucun nom de repli produit ne peut tenir lieu de responsable", () => {
    // La garde explicite de la DECISION_1 : ni le nom du produit, ni le nom d'affichage
    // d'instance ne doivent apparaître comme responsable du traitement.
    const manquants = champsManquantsPourNotice(VIDE);
    expect(manquants).toContain("controllerLegalName");
    const serialise = JSON.stringify({ identite: VIDE, libelles: LIBELLES_CHAMPS_REQUIS });
    expect(serialise).not.toMatch(/DOMIORA/i);
    expect(serialise).not.toMatch(/Conseiller DOMIORA/i);
  });
});

describe("T8 / T9 / T10 / T11 — minimum requis pour la notice", () => {
  it("T8 — pas prête si le nom légal est absent", () => {
    const sansNom = { ...MINIMUM, controllerLegalName: null };
    expect(identiteResponsablePrete(sansNom)).toBe(false);
    expect(champsManquantsPourNotice(sansNom)).toEqual(["controllerLegalName"]);
  });

  it("T9 — pas prête si l'adresse postale est incomplète", () => {
    for (const champ of ["controllerAddressLine1", "controllerPostalCode", "controllerCity", "controllerCountryCode"] as const) {
      const ampute = { ...MINIMUM, [champ]: null };
      expect(identiteResponsablePrete(ampute), champ).toBe(false);
      expect(champsManquantsPourNotice(ampute), champ).toEqual([champ]);
    }
  });

  it("T10 — pas prête si l'adresse d'exercice des droits est absente", () => {
    const sansDroits = { ...MINIMUM, privacyRightsEmail: null };
    expect(identiteResponsablePrete(sansDroits)).toBe(false);
    expect(champsManquantsPourNotice(sansDroits)).toEqual(["privacyRightsEmail"]);
  });

  it("T11 — prête lorsque le minimum est réuni", () => {
    expect(identiteResponsablePrete(MINIMUM)).toBe(true);
    expect(champsManquantsPourNotice(MINIMUM)).toEqual([]);
    expect(etatIdentiteResponsable(MINIMUM)).toBe("PRETE_POUR_LA_NOTICE");
  });

  it("une chaîne d'espaces ne vaut pas une valeur renseignée", () => {
    // Sinon une touche espace suffirait à déclarer une identité complète.
    expect(identiteResponsablePrete({ ...MINIMUM, controllerLegalName: "   " })).toBe(false);
    expect(identiteResponsablePrete({ ...MINIMUM, privacyRightsEmail: "\t" })).toBe(false);
  });

  it("tous les champs manquants sont rapportés ensemble, pas seulement le premier", () => {
    expect([...champsManquantsPourNotice(VIDE)].sort()).toEqual([...CHAMPS_REQUIS_POUR_NOTICE].sort());
  });

  it("chaque champ requis possède un libellé affichable", () => {
    for (const champ of CHAMPS_REQUIS_POUR_NOTICE) {
      expect(LIBELLES_CHAMPS_REQUIS[champ], champ).toBeTruthy();
    }
  });
});

describe("T12 — champs facultatifs", () => {
  it("le DPO reste facultatif : son absence n'empêche pas la notice", () => {
    expect(identiteResponsablePrete({ ...MINIMUM, dpoName: null, dpoEmail: null })).toBe(true);
  });

  it("le SIREN reste facultatif : une personne physique en EI peut ne pas en déclarer", () => {
    expect(identiteResponsablePrete({ ...MINIMUM, controllerSiren: null })).toBe(true);
    expect(CHAMPS_REQUIS_POUR_NOTICE as readonly string[]).not.toContain("controllerSiren");
  });

  it("forme juridique et nom commercial restent facultatifs", () => {
    expect(identiteResponsablePrete({ ...MINIMUM, controllerLegalForm: null, controllerTradeName: null })).toBe(true);
  });

  it("le complément d'adresse reste facultatif", () => {
    expect(identiteResponsablePrete({ ...MINIMUM, controllerAddressLine2: null })).toBe(true);
  });

  it("une personne morale est représentable aussi bien qu'une personne physique", () => {
    const societe = { ...MINIMUM, controllerLegalName: "Agence Lilas SAS", controllerLegalForm: "SAS", controllerSiren: "123456789" };
    expect(identiteResponsablePrete(societe)).toBe(true);
  });
});
