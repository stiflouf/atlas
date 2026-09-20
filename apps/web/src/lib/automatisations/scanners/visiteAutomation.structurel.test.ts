import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// VISIT_AUTOMATION_V1 (ADR-063) — gardes structurelles du périmètre (brief §49) : aucun Calendar ID
// dans les scanners Visit, aucune automation Bon signé, aucune IA, aucun BuyerProject, aucune
// dépendance provider de signature, les tâches ciblent bien `visiteCanoniqueId` (jamais l'ancien
// `visiteId`/compte-rendu, jamais un contournement Calendar).
function lireFichier(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
}

const FICHIERS_SCANNERS_VISIT = ["./visiteJ1.ts", "./visiteSansCompteRendu.ts"];

describe("VISIT_AUTOMATION_V1 — gardes structurelles", () => {
  it("aucun scanner Visit ne référence un identifiant Calendar", () => {
    for (const chemin of FICHIERS_SCANNERS_VISIT) {
      const source = lireFichier(chemin);
      expect(source.toLowerCase()).not.toContain("calendar");
      expect(source).not.toContain("rendezVousCalendarId");
    }
  });

  it("aucun scanner Visit ne câble une automation Bon signé, un provider de signature, ou l'IA", () => {
    for (const chemin of FICHIERS_SCANNERS_VISIT) {
      const source = lireFichier(chemin);
      expect(source).not.toMatch(/bonVisite|bon_visite|signature/i);
      expect(source.toLowerCase()).not.toMatch(/\bia\b|openai|anthropic|llm/);
      expect(source).not.toMatch(/BuyerProject/i);
    }
  });

  it("les scanners Visit ciblent visiteCanoniqueId (jamais l'ancien visiteId/compte-rendu)", () => {
    for (const chemin of FICHIERS_SCANNERS_VISIT) {
      const source = lireFichier(chemin);
      expect(source).toContain("visiteCanoniqueId");
    }
  });

  it("aucune règle du catalogue ne consomme bon_visite_signe (aucune automation Bon signé ajoutée par ce lot)", async () => {
    const { CATALOGUE_REGLES_AUTOMATISATION } = await import("../catalogueRegles");
    const codes = CATALOGUE_REGLES_AUTOMATISATION.map((r) => r.typeEvenement);
    expect(codes).not.toContain("bon_visite_signe");
  });

  it("visite_j_1 et visite_sans_compte_rendu sont présentes dans le catalogue ET le registre", async () => {
    const { CATALOGUE_REGLES_AUTOMATISATION } = await import("../catalogueRegles");
    const { SCANNERS_TEMPORELS } = await import("../scanTemporel");
    const codesCatalogue = new Set(CATALOGUE_REGLES_AUTOMATISATION.map((r) => r.code));
    const codesRegistre = new Set(SCANNERS_TEMPORELS.map((s) => s.codeRegle));
    expect(codesCatalogue.has("visite_j_1")).toBe(true);
    expect(codesCatalogue.has("visite_sans_compte_rendu")).toBe(true);
    expect(codesRegistre.has("visite_j_1")).toBe(true);
    expect(codesRegistre.has("visite_sans_compte_rendu")).toBe(true);
  });
});
