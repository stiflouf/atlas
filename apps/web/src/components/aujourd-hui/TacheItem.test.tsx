import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Tache } from "@/types/tache";
import TacheItem from "./TacheItem";

function tacheTest(surcharge: Partial<Tache> = {}): Tache {
  return {
    id: "tache-test",
    titre: "Tâche de test",
    type: "autre",
    priorite: "normale",
    origine: "manuelle",
    creeLe: "2026-01-01T10:00:00.000Z",
    ...surcharge,
  };
}

function render(tache: Tache): string {
  return renderToStaticMarkup(TacheItem({ tache }));
}

describe("TacheItem — Voir la fiche (ADR-039)", () => {
  it("cible acquéreur : lien vers la fiche acquéreur", () => {
    const html = render(tacheTest({ acquereurId: "acq-1" }));
    expect(html).toContain("Voir la fiche");
    expect(html).toContain('href="/clients/acq-1"');
  });

  it("cible bien : lien vers la fiche bien", () => {
    const html = render(tacheTest({ bienId: "bien-1" }));
    expect(html).toContain("Voir la fiche");
    expect(html).toContain('href="/biens/bien-1"');
  });

  it("cible prospect vendeur : lien vers la fiche prospect vendeur", () => {
    const html = render(tacheTest({ prospectVendeurId: "prospect-1" }));
    expect(html).toContain("Voir la fiche");
    expect(html).toContain('href="/prospects-vendeurs/prospect-1"');
  });

  it("tâche sans cible : aucun lien « Voir la fiche »", () => {
    const html = render(tacheTest());
    expect(html).not.toContain("Voir la fiche");
  });

  it("cible visite/offre/compromis/remuneration : aucune fiche navigable, aucun lien factice", () => {
    for (const surcharge of [
      { visiteId: "visite-1" },
      { offreId: "offre-1" },
      { compromisId: "compromis-1" },
      { remunerationId: "remuneration-1" },
    ] satisfies Partial<Tache>[]) {
      const html = render(tacheTest(surcharge));
      expect(html).not.toContain("Voir la fiche");
    }
  });
});

describe("TacheItem — nouveau match ADR-037 : non-régression", () => {
  it("Voir la fiche pointe vers l'acquéreur, Préparer un email reste disponible, aucun lien Bien reconstruit", () => {
    const tache = tacheTest({
      id: "8f14e45f-ceea-4d1a-8e4b-0f3d5a2c1b90",
      titre: "Nouveau match — contacter Julie Martin pour HOU-2026-014",
      type: "appel",
      origine: "automatique",
      origineCode: "nouveau_match_bien_acquereur",
      acquereurId: "acq-julie",
    });
    const html = render(tache);
    expect(html).toContain('href="/clients/acq-julie"');
    expect(html).toContain(`href="/communications/nouveau?tacheId=${tache.id}"`);
    expect(html).not.toContain("/biens/"); // aucun lien Bien, jamais reconstruit depuis le titre
  });
});

describe("TacheItem — Préparer un email (non-régression)", () => {
  it("disponible dès qu'une cible existe, quel que soit son type, pour une tâche réelle (id UUID)", () => {
    const html = render(tacheTest({ id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", bienId: "bien-1" }));
    expect(html).toContain("Préparer un email");
  });

  it("absent si aucune cible", () => {
    const html = render(tacheTest({ id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e" }));
    expect(html).not.toContain("Préparer un email");
  });

  // Bugfix pilote : tant qu'aucune tâche réelle n'existe en base, listerTaches() (tacheRepository.ts)
  // se replie sur les tâches de démonstration (id non-UUID, ex. "tache-001") — communications/nouveau
  // résout la tâche via getTacheById, qui rejette tout id non-UUID et renvoie donc un 404. Le lien ne
  // doit jamais être proposé pour une tâche que la page cible ne pourra pas résoudre.
  it("absent pour une tâche de démonstration (id non-UUID) — la page cible 404rait sinon", () => {
    const html = render(tacheTest({ id: "tache-001", bienId: "bien-1" }));
    expect(html).not.toContain("Préparer un email");
  });
});

describe("TacheItem — badge En retard (ADR-039, réutilise estEnRetard existante)", () => {
  it("tâche avec échéance dépassée : badge visible", () => {
    const html = render(tacheTest({ echeance: "2020-01-01" }));
    expect(html).toContain("En retard");
  });

  it("tâche avec échéance future : aucun badge", () => {
    const dansUnAn = new Date();
    dansUnAn.setFullYear(dansUnAn.getFullYear() + 1);
    const html = render(tacheTest({ echeance: dansUnAn.toISOString().slice(0, 10) }));
    expect(html).not.toContain("En retard");
  });

  it("tâche sans échéance : jamais en retard, aucun badge", () => {
    const html = render(tacheTest());
    expect(html).not.toContain("En retard");
  });
});

describe("TacheItem — provenance (non-régression)", () => {
  it("tâche automatique : provenance visible avec le libellé de la règle", () => {
    const html = render(tacheTest({ origine: "automatique", origineCode: "nouveau_match_bien_acquereur" }));
    expect(html).toContain("Créée automatiquement");
    expect(html).toContain("Nouveau match Bien × Acquéreur");
  });

  it("tâche manuelle : aucune mention de création automatique", () => {
    const html = render(tacheTest({ origine: "manuelle" }));
    expect(html).not.toContain("Créée automatiquement");
  });
});
