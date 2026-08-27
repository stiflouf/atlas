import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProfilAcquereur } from "@/types/client";
import AcquereurHero from "./AcquereurHero";

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

describe("AcquereurHero", () => {
  it("affiche l'identité réelle — initiales, nom, email, téléphone — aucune donnée inventée", () => {
    const html = renderToStaticMarkup(<AcquereurHero client={clientTest()} />);
    expect(html).toContain("JF");
    expect(html).toContain("Julien");
    expect(html).toContain("Ferreira");
    expect(html).toContain("julien@example.com");
    expect(html).toContain("0600000000");
  });

  it("affiche le budget réel, immédiatement (budgetMin – budgetMax)", () => {
    const html = renderToStaticMarkup(<AcquereurHero client={clientTest({ budgetMin: 250000, budgetMax: 420000 })} />);
    expect(html).toContain("250");
    expect(html).toContain("420");
  });

  it("affiche le stade réel du projet, jamais un score/priorité/urgence inventée", () => {
    const html = renderToStaticMarkup(<AcquereurHero client={clientTest({ stadeProjet: "offre" })} />);
    expect(html).toContain("En attente d&#x27;offre");
    expect(html).not.toMatch(/\bscore\b/i);
    expect(html).not.toMatch(/priorit[ée]/i);
    expect(html).not.toMatch(/urgence/i);
  });

  it("affiche le suivi depuis la vraie date de premier contact", () => {
    const html = renderToStaticMarkup(<AcquereurHero client={clientTest({ datePremiereContact: "2026-02-10" })} />);
    expect(html).toContain("10 février 2026");
  });

  it("affiche Modifier/Archiver pour un acquéreur réel (id UUID), les masque pour un acquéreur mocké", () => {
    const reel = renderToStaticMarkup(<AcquereurHero client={clientTest()} />);
    expect(reel).toContain("Modifier");
    expect(reel).toContain("Archiver");
    expect(reel).toContain('href="/clients/550e8400-e29b-41d4-a716-446655440000/modifier"');

    const mocke = renderToStaticMarkup(<AcquereurHero client={clientTest({ id: "client-001" })} />);
    expect(mocke).not.toContain("Modifier");
    expect(mocke).not.toContain("Archiver");
  });

  it("masque + Ajouter une tâche et l'action d'archivage pour un acquéreur déjà archivé, affiche Désarchiver", () => {
    const html = renderToStaticMarkup(<AcquereurHero client={clientTest({ archiveLe: "2026-03-01T00:00:00.000Z" })} />);
    expect(html).not.toContain("+ Ajouter une tâche");
    expect(html).toContain("Désarchiver");
    expect(html).toContain("Archivé le");
  });
});
