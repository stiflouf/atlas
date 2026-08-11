import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import type { DossierBien } from "@/data/dossier";
import type { ActionMetier } from "@/types/action";
import type { NoteBien } from "@/types/noteBien";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
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
    historique: [{ date: "2026-08-01", auteur: "Steven G.", texte: "Signature du mandat." }],
    notes: "",
    documents: [],
    visitesEffectuees: [],
  };
}

const TOUS_LES_ONGLETS = ["Contexte", "Historique", "Notes", "Visites", "Documents", "Actions"];

describe("BienTabs", () => {
  it("n'affiche que Contexte, Notes et Actions pour un bien réel sans dossier", () => {
    const html = renderToStaticMarkup(
      <BienTabs
        bien={bienTest()}
        actions={[] as ActionMetier[]}
        notes={[] as NoteBien[]}
        comptesRendus={[] as CompteRenduVisite[]}
      />
    );

    expect(html).toContain("Contexte");
    expect(html).toContain("Notes");
    expect(html).toContain("Actions");
    for (const onglet of ["Historique", "Visites", "Documents"]) {
      expect(html).not.toContain(onglet);
    }
  });

  it("conserve tous les onglets existants quand un dossier (mock) est fourni", () => {
    const html = renderToStaticMarkup(
      <BienTabs
        bien={bienTest()}
        dossier={dossierTest()}
        actions={[] as ActionMetier[]}
        notes={[] as NoteBien[]}
        comptesRendus={[] as CompteRenduVisite[]}
      />
    );

    for (const onglet of TOUS_LES_ONGLETS) {
      expect(html).toContain(onglet);
    }
  });

  it("affiche l'onglet Historique pour un bien réel dès qu'un événement dérivé existe (creeLe ou actions)", () => {
    // Le contenu de l'onglet (texte des événements) n'est visible qu'après un clic (état client
    // "active"), non exécuté par renderToStaticMarkup : la génération des textes eux-mêmes est
    // couverte par lib/historiqueBien.test.ts. Ici on vérifie seulement que l'onglet apparaît.
    const actions: ActionMetier[] = [
      {
        id: "action-1",
        titre: "Envoyer les diagnostics",
        statut: "termine",
        priorite: "normale",
        type: "document",
        creeLe: "2026-08-01T10:00:00.000Z",
        termineLe: "2026-08-05T14:00:00.000Z",
      },
    ];
    const html = renderToStaticMarkup(
      <BienTabs
        bien={bienTest({ creeLe: "2026-01-01T09:00:00.000Z" })}
        actions={actions}
        notes={[] as NoteBien[]}
        comptesRendus={[] as CompteRenduVisite[]}
      />
    );

    expect(html).toContain("Historique");
    for (const onglet of ["Visites", "Documents"]) {
      expect(html).not.toContain(onglet);
    }
  });

  it("affiche l'onglet Historique pour un bien réel dès qu'un compte rendu de visite existe, sans creeLe ni action", () => {
    const comptesRendus: CompteRenduVisite[] = [
      {
        id: "cr-1",
        bienId: "bien-test",
        acquereurId: "acquereur-test",
        dateVisite: "2026-08-03",
        retour: "Très intéressés.",
        interet: "interesse",
        creeLe: "2026-08-03T18:00:00.000Z",
      },
    ];
    const html = renderToStaticMarkup(
      <BienTabs
        bien={bienTest({ creeLe: undefined })}
        actions={[] as ActionMetier[]}
        notes={[] as NoteBien[]}
        comptesRendus={comptesRendus}
      />
    );

    expect(html).toContain("Historique");
  });

  it("affiche l'onglet Notes pour un bien réel même sans aucune note", () => {
    const html = renderToStaticMarkup(
      <BienTabs
        bien={bienTest()}
        actions={[] as ActionMetier[]}
        notes={[] as NoteBien[]}
        comptesRendus={[] as CompteRenduVisite[]}
      />
    );

    expect(html).toContain("Notes");
  });
});
