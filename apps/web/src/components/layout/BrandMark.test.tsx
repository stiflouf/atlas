import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// BRANDMARK-DEMO-01 — le logo maître s'affiche UNIQUEMENT depuis l'asset approuvé
// (brand/FONDATIONS.md § 1). Test structurel sur le source plutôt que sur le rendu : ce qui doit
// être verrouillé, c'est qu'aucun tracé ne soit réintroduit et qu'aucune transformation ne soit
// appliquée à l'image — deux choses qu'un rendu HTML ne dirait pas plus clairement que le fichier.
const source = readFileSync(join(__dirname, "BrandMark.tsx"), "utf8");

describe("BrandMark — logo maître", () => {
  it("affiche l'asset approuvé, jamais un symbole reconstruit", () => {
    expect(source).toContain("/brand/domiora-mark-flamme-discrete.png");
  });

  it("ne contient plus le monogramme temporaire retiré (triangle et barres)", () => {
    expect(source).not.toContain("<svg");
    expect(source).not.toContain("polygon");
    expect(source).not.toContain("#c59a5b");
  });

  it("n'applique au logo ni recoloration, ni filtre, ni opacité, ni recadrage", () => {
    for (const transformation of ["filter", "opacity", "grayscale", "invert", "object-cover", "mix-blend"]) {
      expect(source).not.toContain(transformation);
    }
    // Ratio conservé explicitement : l'asset est carré, le conteneur aussi.
    expect(source).toContain("object-contain");
  });
});
