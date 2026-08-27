import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CibleTacheSelecteur, { appliquerExclusiviteCible, type CiblesTache } from "./CibleTacheSelecteur";

describe("appliquerExclusiviteCible — exclusivité UI des trois cibles (correctif UX)", () => {
  const vide: CiblesTache = { bienId: "", acquereurId: "", prospectVendeurId: "" };

  it("sélectionner un bien vide l'acquéreur et le prospect vendeur déjà renseignés", () => {
    const cibles: CiblesTache = { bienId: "", acquereurId: "acq-1", prospectVendeurId: "" };
    expect(appliquerExclusiviteCible(cibles, "bienId", "bien-1")).toEqual({
      bienId: "bien-1",
      acquereurId: "",
      prospectVendeurId: "",
    });
  });

  it("sélectionner un acquéreur vide le bien et le prospect vendeur déjà renseignés", () => {
    const cibles: CiblesTache = { bienId: "bien-1", acquereurId: "", prospectVendeurId: "" };
    expect(appliquerExclusiviteCible(cibles, "acquereurId", "acq-1")).toEqual({
      bienId: "",
      acquereurId: "acq-1",
      prospectVendeurId: "",
    });
  });

  it("sélectionner un prospect vendeur vide le bien et l'acquéreur déjà renseignés", () => {
    const cibles: CiblesTache = { bienId: "bien-1", acquereurId: "acq-1", prospectVendeurId: "" };
    expect(appliquerExclusiviteCible(cibles, "prospectVendeurId", "prospect-1")).toEqual({
      bienId: "",
      acquereurId: "",
      prospectVendeurId: "prospect-1",
    });
  });

  it("repasser une cible à Aucun (valeur vide) ne renseigne jamais une autre cible", () => {
    const cibles: CiblesTache = { bienId: "bien-1", acquereurId: "", prospectVendeurId: "" };
    expect(appliquerExclusiviteCible(cibles, "bienId", "")).toEqual(vide);
  });
});

describe("CibleTacheSelecteur — rendu initial", () => {
  it("ne présélectionne que la cible initiale fournie, les deux autres restent sur Aucun", () => {
    const html = renderToStaticMarkup(
      <CibleTacheSelecteur
        biens={[{ id: "bien-1", label: "Bel appartement" }]}
        acquereurs={[{ id: "acq-1", label: "Julien Ferreira" }]}
        prospectsVendeurs={[{ id: "prospect-1", label: "Corinne Assayag" }]}
        bienIdInitial=""
        acquereurIdInitial="acq-1"
        prospectVendeurIdInitial=""
      />
    );
    // React sérialise un <select> contrôlé en marquant l'<option> correspondante `selected=""`,
    // jamais un attribut `value` sur le <select> lui-même.
    expect(html).toContain('<option value="acq-1" selected="">Julien Ferreira</option>');
    expect(html).toMatch(/name="bienId"[^>]*><option value="" selected="">Aucun<\/option>/);
    expect(html).toMatch(/name="prospectVendeurId"[^>]*><option value="" selected="">Aucun<\/option>/);
  });

  it("affiche l'indication d'exclusivité", () => {
    const html = renderToStaticMarkup(
      <CibleTacheSelecteur
        biens={[]}
        acquereurs={[]}
        prospectsVendeurs={[]}
        bienIdInitial=""
        acquereurIdInitial=""
        prospectVendeurIdInitial=""
      />
    );
    expect(html).toContain("une seule cible à la fois");
  });
});
