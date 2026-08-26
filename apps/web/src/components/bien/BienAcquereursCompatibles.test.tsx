import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProfilAcquereur } from "@/types/client";
import type { ResultatCompatibilite } from "@/lib/compatibilite/types";
import BienAcquereursCompatibles from "./BienAcquereursCompatibles";

function acquereurTest(surcharge: Partial<ProfilAcquereur> = {}): ProfilAcquereur {
  return {
    id: "acq-1",
    prenom: "Julien",
    nom: "Ferreira",
    email: "julien@example.com",
    telephone: "0600000000",
    budgetMin: 300000,
    budgetMax: 500000,
    criteres: [],
    stadeProjet: "recherche_active",
    notes: "",
    datePremiereContact: "2026-01-01",
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
        explication: "Budget et secteur compatibles",
      },
    ],
    ...surcharge,
  };
}

describe("BienAcquereursCompatibles", () => {
  it("affiche les comptages réels compatible/à vérifier — jamais un score ni un pourcentage", () => {
    const html = renderToStaticMarkup(
      <BienAcquereursCompatibles
        compatibilites={[
          resultatTest({ acquereurId: "acq-1", statutGlobal: "compatible" }),
          resultatTest({ acquereurId: "acq-2", statutGlobal: "a_verifier" }),
        ]}
        acquereursActifs={[acquereurTest({ id: "acq-1" }), acquereurTest({ id: "acq-2", nom: "Kourouma" })]}
      />
    );
    expect(html).toContain("1 compatible");
    expect(html).toContain("1 à vérifier");
    expect(html).not.toMatch(/%\s*compatib/i);
    expect(html).not.toMatch(/\bscore\b/i);
  });

  it("masque les acquéreurs incompatibles par défaut, sous un <details> — jamais supprimés, juste repliés", () => {
    const html = renderToStaticMarkup(
      <BienAcquereursCompatibles
        compatibilites={[
          resultatTest({ acquereurId: "acq-1", statutGlobal: "compatible" }),
          resultatTest({ acquereurId: "acq-2", statutGlobal: "incompatible" }),
        ]}
        acquereursActifs={[acquereurTest({ id: "acq-1" }), acquereurTest({ id: "acq-2", nom: "Kourouma" })]}
      />
    );
    expect(html).toContain("<details");
    expect(html).toContain("1 acquéreur non compatible");
    expect(html).toContain("Kourouma");
  });

  it("affiche un état vide réel quand aucun acquéreur actif n'existe — pas de donnée fictive", () => {
    const html = renderToStaticMarkup(<BienAcquereursCompatibles compatibilites={[]} acquereursActifs={[]} />);
    expect(html).toContain("Aucun acquéreur actif à comparer");
  });

  it("permet d'ouvrir la fiche de l'acquéreur compatible via le vrai lien /clients/[id]", () => {
    const html = renderToStaticMarkup(
      <BienAcquereursCompatibles
        compatibilites={[resultatTest({ acquereurId: "acq-1", statutGlobal: "compatible" })]}
        acquereursActifs={[acquereurTest({ id: "acq-1" })]}
      />
    );
    expect(html).toContain('href="/clients/acq-1"');
  });
});
