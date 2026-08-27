import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProfilAcquereur } from "@/types/client";
import AcquereurBrief from "./AcquereurBrief";

function clientTest(surcharge: Partial<ProfilAcquereur> = {}): ProfilAcquereur {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    prenom: "Julien",
    nom: "Ferreira",
    email: "julien@example.com",
    telephone: "0600000000",
    budgetMin: 300000,
    budgetMax: 500000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-15",
    ...surcharge,
  };
}

describe("AcquereurBrief", () => {
  it("affiche le budget maximum réel (champ effectivement lu par le moteur)", () => {
    const html = renderToStaticMarkup(<AcquereurBrief client={clientTest({ budgetMax: 480000 })} />);
    expect(html).toContain("480");
  });

  it("affiche Non renseigné pour chaque champ structuré absent — jamais une valeur fictive ni un refus implicite", () => {
    const html = renderToStaticMarkup(<AcquereurBrief client={clientTest()} />);
    expect(html.match(/Non renseigné/g)?.length).toBe(5);
  });

  it("affiche les vraies valeurs quand les champs structurés sont renseignés", () => {
    const html = renderToStaticMarkup(
      <AcquereurBrief
        client={clientTest({
          piecesMin: 3,
          surfaceMin: 65,
          necessiteExterieur: true,
          necessiteParking: false,
          accessibiliteRequise: true,
        })}
      />
    );
    expect(html).toContain("3");
    expect(html).toContain("65 m²");
    expect(html).toContain("Requis");
    expect(html).toContain("Non requis");
  });

  it("n'affiche aucun type de bien recherché et aucune classification essentiel/secondaire (champs inexistants)", () => {
    const html = renderToStaticMarkup(<AcquereurBrief client={clientTest()} />);
    expect(html).not.toMatch(/type de bien/i);
    expect(html).not.toMatch(/essentiel/i);
    expect(html).not.toMatch(/secondaire/i);
  });
});
