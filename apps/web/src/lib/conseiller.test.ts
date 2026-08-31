import { afterEach, describe, expect, it, vi } from "vitest";
import { obtenirInitialesConseiller, obtenirNomConseiller } from "./conseiller";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("obtenirNomConseiller — identité affichée de l'instance", () => {
  it("rend le nom configuré pour l'instance", () => {
    vi.stubEnv("ATLAS_ADVISOR_DISPLAY_NAME", "Bérengère Calais");
    expect(obtenirNomConseiller()).toBe("Bérengère Calais");
  });

  it("rend un nom neutre quand la variable est absente, jamais l'identité de quelqu'un d'autre", () => {
    vi.stubEnv("ATLAS_ADVISOR_DISPLAY_NAME", undefined);
    expect(obtenirNomConseiller()).toBe("Conseiller DOMIORA");
  });

  it("traite une valeur vide ou blanche comme absente", () => {
    vi.stubEnv("ATLAS_ADVISOR_DISPLAY_NAME", "   ");
    expect(obtenirNomConseiller()).toBe("Conseiller DOMIORA");
  });

  it("normalise les espaces superflus plutôt que de les afficher tels quels", () => {
    vi.stubEnv("ATLAS_ADVISOR_DISPLAY_NAME", "  Bérengère   Calais  ");
    expect(obtenirNomConseiller()).toBe("Bérengère Calais");
  });
});

describe("obtenirInitialesConseiller", () => {
  it("prend les initiales des deux premiers mots", () => {
    expect(obtenirInitialesConseiller("Bérengère Calais")).toBe("BC");
    expect(obtenirInitialesConseiller("Steven Gausset")).toBe("SG");
    expect(obtenirInitialesConseiller("Conseiller DOMIORA")).toBe("CD");
  });

  it("ignore les mots au-delà du deuxième", () => {
    expect(obtenirInitialesConseiller("Jean Pierre Dupont")).toBe("JP");
  });

  it("rend une seule initiale pour un nom d'un seul mot", () => {
    expect(obtenirInitialesConseiller("DOMIORA")).toBe("D");
  });

  it("tolère les espaces superflus", () => {
    expect(obtenirInitialesConseiller("  Bérengère   Calais  ")).toBe("BC");
  });

  it("retombe sur les initiales neutres plutôt que de rendre une chaîne vide", () => {
    expect(obtenirInitialesConseiller("   ")).toBe("CD");
  });
});
