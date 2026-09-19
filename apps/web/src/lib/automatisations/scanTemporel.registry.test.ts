import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCANNERS_TEMPORELS } from "./scanTemporel";
import { CATALOGUE_REGLES_AUTOMATISATION } from "./catalogueRegles";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — garde structurelle du registre (brief §47/§50) : chaque
// scanner déclaré a un code catalogue réel, aucun code dupliqué, et la route de scan ne référence
// aucun code de règle ni repository métier spécifique — seul le registre le fait.
describe("SCANNERS_TEMPORELS — registre du moteur temporel", () => {
  it("chaque scanner déclaré correspond à une règle réelle du catalogue", () => {
    const codesCatalogue = new Set(CATALOGUE_REGLES_AUTOMATISATION.map((r) => r.code));
    for (const scanner of SCANNERS_TEMPORELS) {
      expect(codesCatalogue.has(scanner.codeRegle), `${scanner.codeRegle} absent du catalogue`).toBe(true);
    }
  });

  it("aucun code dupliqué dans le registre", () => {
    const codes = SCANNERS_TEMPORELS.map((s) => s.codeRegle);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("les 4 règles temporelles attendues sont bien enregistrées (généralisation V1)", () => {
    const codes = SCANNERS_TEMPORELS.map((s) => s.codeRegle).sort();
    expect(codes).toEqual(
      ["inactivite_prospect_vendeur", "mandat_expire_bientot", "offre_acceptee_sans_compromis", "offre_sans_decision"].sort()
    );
  });

  it("la route de scan ne référence aucun code de règle ni repository métier spécifique — seul le registre", () => {
    const cheminRoute = fileURLToPath(new URL("../../app/api/automatisations/scan/route.ts", import.meta.url));
    const source = readFileSync(cheminRoute, "utf8");
    expect(source).not.toContain("mandatRepository");
    expect(source).not.toContain("offreRepository");
    expect(source).not.toContain("prospectVendeurRepository");
    for (const scanner of SCANNERS_TEMPORELS) {
      expect(source).not.toContain(`"${scanner.codeRegle}"`);
      expect(source).not.toContain(`'${scanner.codeRegle}'`);
    }
    expect(source).toContain("executerScanTemporelComplet");
  });
});
