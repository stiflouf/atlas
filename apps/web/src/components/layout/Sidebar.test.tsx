import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Même mock que NavItems.test.tsx : la sidebar rend NavItems, qui appelle usePathname().
const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

import Sidebar from "./Sidebar";

function rendre(nomConseiller: string, initialesConseiller: string): string {
  usePathnameMock.mockReturnValue("/");
  return renderToStaticMarkup(
    <Sidebar nomConseiller={nomConseiller} initialesConseiller={initialesConseiller} />
  );
}

describe("Sidebar — identité du conseiller", () => {
  it("affiche le nom et les initiales reçus en props", () => {
    const html = rendre("Bérengère Calais", "BC");

    expect(html).toContain("Bérengère Calais");
    expect(html).toContain(">BC<");
  });

  it("affiche l'identité neutre du showroom quand c'est elle qui est configurée", () => {
    const html = rendre("Conseiller DOMIORA", "CD");

    expect(html).toContain("Conseiller DOMIORA");
    expect(html).toContain(">CD<");
  });

  // Régression DEMO-04 : l'identité du conseiller était codée en dur dans ce composant, ce qui
  // faisait apparaître le nom de l'exploitant sur toute instance déployée — y compris un showroom
  // montré à des tiers, ou l'instance d'un autre conseiller.
  it("ne contient plus aucune identité codée en dur dans son source", () => {
    const html = rendre("Conseiller DOMIORA", "CD");

    expect(html).not.toContain("Steven Gausset");
    expect(html).not.toContain(">SG<");
  });
});
