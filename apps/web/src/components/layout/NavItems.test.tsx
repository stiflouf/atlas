import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

import NavItems from "./NavItems";

function balisesLien(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
}

function lienVers(html: string, href: string): string | undefined {
  return balisesLien(html).find((balise) => balise.includes(`href="${href}"`));
}

describe("NavItems", () => {
  it("variante sidebar : landmark nommé, lien courant marqué, les autres non", () => {
    usePathnameMock.mockReturnValue("/biens/123");
    const html = renderToStaticMarkup(<NavItems variant="sidebar" />);

    expect(html).toContain('aria-label="Navigation principale"');
    expect(lienVers(html, "/biens")).toContain('aria-current="page"');
    expect(lienVers(html, "/clients")).not.toContain("aria-current");
  });

  it("racine : « / » est courant, « /dashboard » ne l'est pas", () => {
    usePathnameMock.mockReturnValue("/");
    const html = renderToStaticMarkup(<NavItems variant="sidebar" />);

    expect(lienVers(html, "/")).toContain('aria-current="page"');
    expect(lienVers(html, "/dashboard")).not.toContain("aria-current");
  });

  it("variante bottom : landmark nommé et état actif également exprimé", () => {
    usePathnameMock.mockReturnValue("/clients");
    const html = renderToStaticMarkup(<NavItems variant="bottom" />);

    expect(html).toContain('aria-label="Navigation principale"');
    expect(lienVers(html, "/clients")).toContain('aria-current="page"');
    expect(lienVers(html, "/biens")).not.toContain("aria-current");
  });
});
