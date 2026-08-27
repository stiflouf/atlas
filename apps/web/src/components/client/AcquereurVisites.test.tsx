import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import type { Visite } from "@/types/visite";
import AcquereurVisites from "./AcquereurVisites";

function visiteTest(surcharge: Partial<Visite> = {}): Visite {
  return {
    id: "visite-1",
    bienId: "bien-1",
    acquereurId: "acq-1",
    datePrevue: "2026-09-01",
    statut: "planifiee",
    rendezVousCalendarId: "gcal-1",
    creeLe: "2026-08-01T00:00:00.000Z",
    ...surcharge,
  };
}

function bienTest(surcharge: Partial<Bien> = {}): Bien {
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

describe("AcquereurVisites", () => {
  it("message simple quand aucune visite n'existe — pas de calendrier ni de compte rendu inventé", () => {
    const html = renderToStaticMarkup(<AcquereurVisites visites={[]} biensParId={new Map()} />);
    expect(html).toContain("Aucune visite enregistrée");
    expect(html).not.toMatch(/compte rendu/i);
  });

  it("affiche le Bien lié, la date et le statut réels d'une visite", () => {
    const html = renderToStaticMarkup(
      <AcquereurVisites
        visites={[visiteTest({ statut: "realisee" })]}
        biensParId={new Map([["bien-1", bienTest()]])}
      />
    );
    expect(html).toContain("Bel appartement");
    expect(html).toContain("1 septembre 2026");
    expect(html).toContain("Réalisée");
  });

  it("affiche Préparer uniquement pour une visite encore planifiee, vers la vraie route existante", () => {
    const planifiee = renderToStaticMarkup(
      <AcquereurVisites visites={[visiteTest({ id: "v-1", statut: "planifiee" })]} biensParId={new Map([["bien-1", bienTest()]])} />
    );
    expect(planifiee).toContain("Préparer");
    expect(planifiee).toContain('href="/visites/v-1/preparer"');

    const realisee = renderToStaticMarkup(
      <AcquereurVisites visites={[visiteTest({ id: "v-2", statut: "realisee" })]} biensParId={new Map([["bien-1", bienTest()]])} />
    );
    expect(realisee).not.toContain("Préparer");
  });

  it("ne mentionne jamais de compte rendu enregistré (garde-fou du chantier)", () => {
    const html = renderToStaticMarkup(
      <AcquereurVisites visites={[visiteTest({ statut: "realisee" })]} biensParId={new Map([["bien-1", bienTest()]])} />
    );
    expect(html).not.toMatch(/compte[\s-]?rendu/i);
  });
});
