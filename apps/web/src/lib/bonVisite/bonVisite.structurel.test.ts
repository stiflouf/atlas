import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOGUE_REGLES_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";

// VISIT_SIGNED_FORM_V1 (ADR-063) — gardes structurelles du périmètre (§61 du brief) : jamais de
// revendication eIDAS/qualifiée, jamais de fournisseur externe câblé, jamais de règle
// d'automatisation consommant bon_visite_signe, lifecycle Visite jamais dépendant du bon.
function lireFichier(chemin: string): string {
  return readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), "utf8");
}

describe("VISIT_SIGNED_FORM_V1 — gardes structurelles", () => {
  it("aucune revendication eIDAS/signature qualifiée dans le code du domaine", () => {
    const fichiers = [
      "./templateBonVisite.ts",
      "./pdfBonVisite.ts",
      "../bonVisiteRepository.ts",
      "../../actions/bonVisite.ts",
    ];
    for (const chemin of fichiers) {
      const source = lireFichier(chemin);
      expect(source.toLowerCase()).not.toContain("eidas");
      expect(source.toLowerCase()).not.toContain("qualifiée");
      expect(source.toLowerCase()).not.toContain("signature avancée");
    }
  });

  it("§9 — le provider de signature reste verrouillé à 'domiora' en V1 (aucun câblage externe)", () => {
    const source = lireFichier("../bonVisiteRepository.ts");
    expect(source).toContain('provider: "domiora"');
    expect(source).not.toMatch(/provider:\s*["'`](?!domiora)/);
  });

  it("aucune règle d'automatisation ne consomme bon_visite_signe (§18/§24 — pas d'automation Visit)", () => {
    const codes = CATALOGUE_REGLES_AUTOMATISATION.map((r) => r.typeEvenement);
    expect(codes).not.toContain("bon_visite_signe");
  });

  it("aucun mot-clé BuyerProject/co-acquéreur générique dans le domaine bon de visite", () => {
    const source = lireFichier("../bonVisiteRepository.ts");
    expect(source).not.toMatch(/BuyerProject/i);
    expect(source).not.toMatch(/participants_visite/i);
  });
});
