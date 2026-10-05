import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CibleTacheSelecteur, { appliquerExclusiviteCible, type CiblesTache } from "./CibleTacheSelecteur";

// TASK_CONTACT_TARGET_V1 (ADR-064) — quatrième cible : le contact canonique entre dans la MÊME
// règle d'exclusivité, pas à côté d'elle.
describe("appliquerExclusiviteCible — exclusivité UI des quatre cibles (correctif UX)", () => {
  const vide: CiblesTache = { bienId: "", acquereurId: "", prospectVendeurId: "", contactId: "" };

  it("sélectionner un bien vide l'acquéreur et le prospect vendeur déjà renseignés", () => {
    const cibles: CiblesTache = { ...vide, acquereurId: "acq-1" };
    expect(appliquerExclusiviteCible(cibles, "bienId", "bien-1")).toEqual({ ...vide, bienId: "bien-1" });
  });

  it("sélectionner un acquéreur vide le bien et le prospect vendeur déjà renseignés", () => {
    const cibles: CiblesTache = { ...vide, bienId: "bien-1" };
    expect(appliquerExclusiviteCible(cibles, "acquereurId", "acq-1")).toEqual({ ...vide, acquereurId: "acq-1" });
  });

  it("sélectionner un prospect vendeur vide le bien et l'acquéreur déjà renseignés", () => {
    const cibles: CiblesTache = { ...vide, bienId: "bien-1", acquereurId: "acq-1" };
    expect(appliquerExclusiviteCible(cibles, "prospectVendeurId", "prospect-1")).toEqual({
      ...vide,
      prospectVendeurId: "prospect-1",
    });
  });

  it("choisir un contact vide les trois cibles dossier déjà renseignées", () => {
    const cibles: CiblesTache = { ...vide, bienId: "bien-1" };
    expect(appliquerExclusiviteCible(cibles, "contactId", "contact-1")).toEqual({ ...vide, contactId: "contact-1" });
  });

  it("choisir une cible dossier retire le contact déjà retenu", () => {
    const cibles: CiblesTache = { ...vide, contactId: "contact-1" };
    expect(appliquerExclusiviteCible(cibles, "acquereurId", "acq-1")).toEqual({ ...vide, acquereurId: "acq-1" });
  });

  it("repasser une cible à Aucun (valeur vide) ne renseigne jamais une autre cible", () => {
    const cibles: CiblesTache = { ...vide, bienId: "bien-1" };
    expect(appliquerExclusiviteCible(cibles, "bienId", "")).toEqual(vide);
  });

  it("retirer le contact retenu ne renseigne jamais une autre cible", () => {
    const cibles: CiblesTache = { ...vide, contactId: "contact-1" };
    expect(appliquerExclusiviteCible(cibles, "contactId", "")).toEqual(vide);
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
    // TASK_CONTACT_TARGET_V1 — aucune cible contact soumise tant qu'aucun contact n'a été choisi,
    // et aucun carnet d'adresses rendu dans le HTML du formulaire.
    expect(html).toContain('<input type="hidden" name="contactId" value=""');
  });

  // TASK_CONTACT_TARGET_V1 (ADR-064)
  it("un contact initial est retenu, affiché avec son email, et soumis comme cible", () => {
    const html = renderToStaticMarkup(
      <CibleTacheSelecteur
        biens={[]}
        acquereurs={[]}
        prospectsVendeurs={[]}
        bienIdInitial=""
        acquereurIdInitial=""
        prospectVendeurIdInitial=""
        contactInitial={{ id: "contact-1", nom: "Dupont", prenom: "Jean", email: "jean@example.test" }}
      />
    );
    expect(html).toContain('<input type="hidden" name="contactId" value="contact-1"');
    expect(html).toContain("Jean Dupont");
    expect(html).toContain("jean@example.test");
  });

  it("un contact initial SANS email le dit explicitement — aucune adresse inventée", () => {
    const html = renderToStaticMarkup(
      <CibleTacheSelecteur
        biens={[]}
        acquereurs={[]}
        prospectsVendeurs={[]}
        bienIdInitial=""
        acquereurIdInitial=""
        prospectVendeurIdInitial=""
        contactInitial={{ id: "contact-2", nom: "Dupont", prenom: "Jean" }}
      />
    );
    expect(html).toContain("aucune adresse email connue");
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
