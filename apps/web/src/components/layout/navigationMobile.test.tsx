import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => usePathnameMock() }));

import NavItems from "./NavItems";
import BottomNav from "./BottomNav";

// DEMO_UX_HARDENING_V1 — la barre du bas déborde dès qu'un item ne peut ni se comprimer ni
// défiler. Ces gardes tiennent les trois propriétés qui l'en empêchent, sans figer un style.
const ENTREES = [
  ["/", "Aujourd'hui"],
  ["/dashboard", "Tableau de bord"],
  ["/biens", "Biens"],
  ["/contacts", "Contacts"],
  ["/clients", "Acquéreurs"],
  ["/prospects-vendeurs", "Prospects vendeurs"],
  ["/fiscal", "Fiscal"],
  ["/automatisations", "Automatisations"],
] as const;

function liens(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
}

describe("Navigation mobile — barre du bas", () => {
  it("les 8 entrées restent présentes et ordonnées dans les deux variantes", () => {
    usePathnameMock.mockReturnValue("/");
    for (const variant of ["sidebar", "bottom"] as const) {
      const html = renderToStaticMarkup(<NavItems variant={variant} />);
      for (const [href, label] of ENTREES) {
        expect(html, `${variant} → ${href}`).toContain(`href="${href}"`);
        // L'apostrophe typographique est échappée par le rendu : on compare sur le HTML échappé.
        const attendu = label.replace(/'/g, "&#x27;");
        expect(html, `${variant} → ${label}`).toContain(`>${attendu}<`);
      }
      const positions = ENTREES.map(([href]) => html.indexOf(`href="${href}"`));
      expect([...positions].sort((a, b) => a - b), variant).toEqual(positions);
    }
  });

  it("la barre du bas défile et ses entrées ne se compriment ni ne se coupent", () => {
    usePathnameMock.mockReturnValue("/fiscal");
    const html = renderToStaticMarkup(<NavItems variant="bottom" />);
    expect(html).toContain("overflow-x-auto");
    for (const balise of liens(html)) {
      expect(balise).toContain("shrink-0");
      expect(balise).toContain("whitespace-nowrap");
      // Le padding large d'origine (px-6) était la moitié du débordement.
      expect(balise).not.toContain("px-6");
    }
  });

  it("l'entrée courante reste identifiable dans la barre du bas", () => {
    usePathnameMock.mockReturnValue("/prospects-vendeurs");
    const html = renderToStaticMarkup(<NavItems variant="bottom" />);
    const courant = liens(html).find((b) => b.includes('href="/prospects-vendeurs"'))!;
    expect(courant).toContain('aria-current="page"');
    expect(liens(html).filter((b) => b.includes("aria-current"))).toHaveLength(1);
  });

  it("la sidebar desktop reste verticale, sans défilement horizontal", () => {
    usePathnameMock.mockReturnValue("/biens");
    const html = renderToStaticMarkup(<NavItems variant="sidebar" />);
    expect(html).toContain("flex flex-col gap-1");
    expect(html).not.toContain("overflow-x-auto");
    expect(html).not.toContain("whitespace-nowrap");
  });

  it("le conteneur de la barre reste fixe, masqué en desktop, et réserve sa hauteur", () => {
    usePathnameMock.mockReturnValue("/");
    const html = renderToStaticMarkup(<BottomNav />);
    expect(html).toContain("md:hidden");
    expect(html).toContain("fixed");
    expect(html).toContain("h-14");
  });
});
