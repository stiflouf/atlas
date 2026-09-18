import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import type { ProspectVendeur } from "@/types/prospectVendeur";
import BienVendeurMandat from "./BienVendeurMandat";

function bienTest(surcharge: Partial<Bien> = {}): Bien {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
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

const ACTIF = { actif: true, libelle: "Actif", variante: "success" } as const;
const SUSPENDU = { actif: false, libelle: "Suspendu", variante: "warning" } as const;

describe("BienVendeurMandat", () => {
  // ADR-060 §1 — le statut affiché est le statut EFFECTIF reçu (tranché par le read model), jamais
  // `bien.statutMandat` : un canonique résilié s'affiche « Aucun mandat en cours » même si le bien
  // porte encore « actif » en legacy.
  it("affiche le statut effectif reçu, jamais bien.statutMandat", () => {
    const html = renderToStaticMarkup(
      <BienVendeurMandat bien={bienTest({ statutMandat: "actif" })} mandatEffectif={{ actif: false, libelle: "Aucun mandat en cours", variante: "muted" }} />
    );
    expect(html).toContain("Aucun mandat en cours");
    expect(html).not.toMatch(/>Actif</);
    const legacy = renderToStaticMarkup(<BienVendeurMandat bien={bienTest({ statutMandat: "suspendu" })} mandatEffectif={SUSPENDU} />);
    expect(legacy).toContain("Suspendu");
  });

  it("affiche le nom du vendeur et un lien vers sa vraie fiche quand prospectVendeurOrigine est fourni", () => {
    const vendeur: ProspectVendeur = {
      id: "pv-1",
      nom: "Assayag",
      prenom: "Corinne",
      creeLe: "2026-01-01T00:00:00.000Z",
      modifieLe: "2026-01-01T00:00:00.000Z",
    };
    const html = renderToStaticMarkup(<BienVendeurMandat bien={bienTest()} prospectVendeurOrigine={vendeur} mandatEffectif={ACTIF} />);
    expect(html).toContain("Corinne");
    expect(html).toContain("Assayag");
    expect(html).toContain('href="/prospects-vendeurs/pv-1"');
  });

  it("affiche un état vide réel (jamais un nom fictif) quand aucun vendeur n'est résolu", () => {
    const html = renderToStaticMarkup(<BienVendeurMandat bien={bienTest()} mandatEffectif={ACTIF} />);
    expect(html).toContain("Non renseigné");
    expect(html).not.toContain("/prospects-vendeurs/");
  });

  it("affiche les honoraires et la copropriété uniquement s'ils sont réellement renseignés", () => {
    const avecDonnees = renderToStaticMarkup(
      <BienVendeurMandat bien={bienTest({ chargeHonoraires: "vendeur", nomCopropriete: "Résidence Les Lilas" })} mandatEffectif={ACTIF} />
    );
    expect(avecDonnees).toContain("Vendeur");
    expect(avecDonnees).toContain("Résidence Les Lilas");

    const sansDonnees = renderToStaticMarkup(<BienVendeurMandat bien={bienTest()} mandatEffectif={ACTIF} />);
    expect(sansDonnees.match(/Non renseigné/g)?.length).toBe(3);
  });
});
