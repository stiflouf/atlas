import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import type { DossierBien } from "@/data/dossier";
import type { ActionMetier } from "@/types/action";
import BienTabs from "./BienTabs";

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

function dossierTest(): DossierBien {
  return {
    bienId: "bien-test",
    statut: "en_commercialisation",
    derniereActivite: "2026-08-01",
    historique: [],
    notes: "",
    documents: [],
    visitesEffectuees: [],
  };
}

const TOUS_LES_ONGLETS = ["Contexte", "Historique", "Notes", "Visites", "Documents", "Actions"];

describe("BienTabs", () => {
  it("n'affiche que Contexte et Actions pour un bien réel sans dossier", () => {
    const html = renderToStaticMarkup(
      <BienTabs bien={bienTest()} actions={[] as ActionMetier[]} />
    );

    expect(html).toContain("Contexte");
    expect(html).toContain("Actions");
    for (const onglet of ["Historique", "Notes", "Visites", "Documents"]) {
      expect(html).not.toContain(onglet);
    }
  });

  it("conserve tous les onglets existants quand un dossier (mock) est fourni", () => {
    const html = renderToStaticMarkup(
      <BienTabs bien={bienTest()} dossier={dossierTest()} actions={[] as ActionMetier[]} />
    );

    for (const onglet of TOUS_LES_ONGLETS) {
      expect(html).toContain(onglet);
    }
  });
});
