import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BienAvecPhotoPrincipale } from "@/lib/bienRepository";
import type { ResultatCompatibilite } from "@/lib/compatibilite/types";
import AcquereurBiensCompatibles from "./AcquereurBiensCompatibles";

function bienTest(surcharge: Partial<BienAvecPhotoPrincipale> = {}): BienAvecPhotoPrincipale {
  return {
    id: "bien-1",
    reference: "AXB-1042",
    titre: "Bel appartement",
    type: "appartement",
    adresse: "12 rue des Lilas",
    ville: "Lyon",
    codePostal: "69006",
    surface: 82,
    pieces: 4,
    prix: 485000,
    statutMandat: "actif",
    dateMandat: "2026-03-12",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

function resultatTest(surcharge: Partial<ResultatCompatibilite> = {}): ResultatCompatibilite {
  return {
    bienId: "bien-1",
    acquereurId: "acq-1",
    statutGlobal: "compatible",
    criteres: [
      {
        critere: "budget_max",
        label: "Budget maximum",
        statut: "compatible",
        explication: "Le prix du bien respecte le budget maximum de l'acquéreur.",
      },
    ],
    ...surcharge,
  };
}

describe("AcquereurBiensCompatibles", () => {
  it("affiche les comptages réels compatible/à vérifier — jamais un score ni un pourcentage", () => {
    const html = renderToStaticMarkup(
      <AcquereurBiensCompatibles
        compatibilites={[
          resultatTest({ bienId: "bien-1", statutGlobal: "compatible" }),
          resultatTest({ bienId: "bien-2", statutGlobal: "a_verifier" }),
        ]}
        biensActifs={[bienTest({ id: "bien-1" }), bienTest({ id: "bien-2", titre: "Maison avec jardin" })]}
      />
    );
    expect(html).toContain("1 compatible");
    expect(html).toContain("1 à vérifier");
    expect(html).not.toMatch(/%\s*compatib/i);
    expect(html).not.toMatch(/\bscore\b/i);
  });

  it("masque les biens incompatibles par défaut, sous un <details> — jamais supprimés, juste repliés", () => {
    const html = renderToStaticMarkup(
      <AcquereurBiensCompatibles
        compatibilites={[
          resultatTest({ bienId: "bien-1", statutGlobal: "compatible" }),
          resultatTest({ bienId: "bien-2", statutGlobal: "incompatible" }),
        ]}
        biensActifs={[bienTest({ id: "bien-1" }), bienTest({ id: "bien-2", titre: "Maison avec jardin" })]}
      />
    );
    expect(html).toContain("<details");
    expect(html).toContain("1 bien non compatible");
    expect(html).toContain("Maison avec jardin");
  });

  it("affiche un état vide réel quand aucun bien actif n'existe — pas de donnée fictive", () => {
    const html = renderToStaticMarkup(<AcquereurBiensCompatibles compatibilites={[]} biensActifs={[]} />);
    expect(html).toContain("Aucun bien actif à comparer");
  });

  it("affiche la vraie photo principale ADR-052 si présente, le fallback PropertyVisual sinon", () => {
    const avecPhoto = renderToStaticMarkup(
      <AcquereurBiensCompatibles
        compatibilites={[resultatTest({ bienId: "bien-1" })]}
        biensActifs={[bienTest({ id: "bien-1", photoPrincipaleId: "photo-1" })]}
      />
    );
    expect(avecPhoto).toContain("/api/photos-bien/photo-1");

    const sansPhoto = renderToStaticMarkup(
      <AcquereurBiensCompatibles
        compatibilites={[resultatTest({ bienId: "bien-1" })]}
        biensActifs={[bienTest({ id: "bien-1", photoPrincipaleId: undefined })]}
      />
    );
    expect(sansPhoto).not.toContain("/api/photos-bien/");
    expect(sansPhoto).toContain("Visuel DOMIORA");
  });

  it("affiche l'explication réelle produite par le moteur et permet d'ouvrir la vraie fiche du bien", () => {
    const html = renderToStaticMarkup(
      <AcquereurBiensCompatibles
        compatibilites={[
          resultatTest({
            bienId: "bien-1",
            criteres: [
              {
                critere: "surface_min",
                label: "Surface minimum",
                statut: "incompatible",
                explication: "Le bien fait 45 m², moins que le minimum recherché (60 m²).",
              },
            ],
          }),
        ]}
        biensActifs={[bienTest({ id: "bien-1" })]}
      />
    );
    expect(html).toContain("Le bien fait 45 m², moins que le minimum recherché (60 m²).");
    expect(html).toContain('href="/biens/bien-1"');
  });
});
