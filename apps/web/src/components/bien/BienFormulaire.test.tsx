import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BienFormulaire from "./BienFormulaire";
import type { Bien } from "@/types/bien";

// ADR-060 §2 (lot MANDATE_CANONICAL_UI_V1) — en ÉDITION, les champs legacy statut/date de mandat
// disparaissent dès que la page dit que le bien a un mandat canonique ; ils restent pour un bien
// legacy-only et à la création. Le serveur ignore de toute façon un payload forgé
// (creationBienMandat.lifecycle.test.ts) : ceci est le côté UX de la même règle.
const bien: Bien = {
  id: "00000000-0000-4000-8000-000000000001",
  reference: "REF-1",
  titre: "Bien",
  type: "appartement",
  adresse: "1 rue",
  ville: "V",
  codePostal: "00000",
  surface: 40,
  pieces: 2,
  prix: 200000,
  statutMandat: "actif",
  dateMandat: "2026-01-15",
  caracteristiques: [],
  description: "",
  creeLe: "2026-01-01T00:00:00.000Z",
};
const action = async () => {};

describe("BienFormulaire — champs legacy de mandat", () => {
  it("A. bien à mandat canonique : aucun champ statutMandat / dateMandat, renvoi vers la fiche", () => {
    const html = renderToStaticMarkup(<BienFormulaire bien={bien} action={action} libelleSubmit="Enregistrer" mandatCanonique />);
    expect(html).not.toContain('name="statutMandat"');
    expect(html).not.toContain('name="dateMandat"');
    expect(html).toContain("se consulte et se modifie depuis sa fiche");
    // Les faits du mandat ne se saisissent pas non plus ici en édition.
    expect(html).not.toContain('name="typeMandat"');
  });

  it("B. bien legacy-only : champs présents, préremplis", () => {
    const html = renderToStaticMarkup(<BienFormulaire bien={bien} action={action} libelleSubmit="Enregistrer" />);
    expect(html).toContain('name="statutMandat"');
    expect(html).toContain('name="dateMandat"');
    expect(html).toContain('value="2026-01-15"');
  });

  it("création : champs legacy et faits du mandat présents", () => {
    const html = renderToStaticMarkup(<BienFormulaire action={action} libelleSubmit="Créer" />);
    expect(html).toContain('name="statutMandat"');
    expect(html).toContain('name="typeMandat"');
  });
});
