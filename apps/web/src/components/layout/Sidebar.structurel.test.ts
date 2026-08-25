import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Régression : la zone photographique premium de la sidebar (public/brand/sidebar-night-house.webp)
// utilisait `h-[clamp(0px,calc(100vh_-_594px),Npx)]` — un minimum de 0px qui la faisait disparaître
// dès qu'un viewport de navigateur réel (chrome inclus) descendait sous ~594px de haut, alors que la
// nav juste au-dessus porte déjà `flex-1 min-h-0 overflow-y-auto` précisément pour absorber ce cas
// par un scroll interne. Ce test ne vérifie pas une classe Tailwind exacte (fragile à toute
// retouche de valeur) : il parse le source réel et vérifie seulement l'invariant qui compte —
// aucun `clamp(...)` de la zone photo desktop ne doit à nouveau autoriser un minimum de 0.

const CHEMIN_SIDEBAR = join(__dirname, "Sidebar.tsx");

function extraireClampsZonePhoto(): string[] {
  const source = readFileSync(CHEMIN_SIDEBAR, "utf8");
  const matches = [...source.matchAll(/h-\[clamp\(([^,]+),[^)]+\)\]/g)];
  return matches.map((m) => m[1]);
}

describe("Sidebar — zone photographique de marque (régression hauteur minimale)", () => {
  it("trouve bien au moins un clamp de hauteur (base + lg) dans le source (le test n'est pas vide)", () => {
    expect(extraireClampsZonePhoto().length).toBeGreaterThanOrEqual(2);
  });

  it.each(extraireClampsZonePhoto())("le minimum du clamp (%s) n'est jamais 0px", (min) => {
    expect(min.trim()).not.toBe("0px");
    expect(parseInt(min, 10)).toBeGreaterThan(0);
  });

  it("n'utilise plus un calc(100vh - Npx) fragile dans une classe de hauteur (dépendait de la hauteur non scrollée de la nav)", () => {
    // Recherche restreinte aux classes `h-[...]` (jamais au texte des commentaires, qui décrivent
    // volontairement l'ancien calcul fautif à des fins d'explication).
    const source = readFileSync(CHEMIN_SIDEBAR, "utf8");
    const classesHauteur = [...source.matchAll(/h-\[[^\]]*\]/g)].map((m) => m[0]);
    expect(classesHauteur.some((c) => c.includes("calc(100vh"))).toBe(false);
  });
});
