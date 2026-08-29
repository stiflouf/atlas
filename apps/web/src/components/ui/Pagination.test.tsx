import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Pagination from "./Pagination";

const construireHref = (page: number) => `/biens?page=${page}`;

describe("Pagination", () => {
  it('porte aria-label="Pagination" sur le landmark de navigation', () => {
    const html = renderToStaticMarkup(<Pagination page={2} totalPages={5} construireHref={construireHref} />);
    expect(html).toContain('aria-label="Pagination"');
  });

  it('porte aria-current="page" sur l\'indicateur de page courante', () => {
    const html = renderToStaticMarkup(<Pagination page={2} totalPages={5} construireHref={construireHref} />);
    expect(html).toContain('aria-current="page"');
  });

  it("page intermédiaire : lien précédent et lien suivant présents avec le href attendu", () => {
    const html = renderToStaticMarkup(<Pagination page={2} totalPages={5} construireHref={construireHref} />);
    expect(html).toContain('href="/biens?page=1"');
    expect(html).toContain('href="/biens?page=3"');
  });

  it("page 1 : pas de lien précédent interactif", () => {
    const html = renderToStaticMarkup(<Pagination page={1} totalPages={5} construireHref={construireHref} />);
    expect(html).not.toContain("Précédent");
    expect(html).not.toContain('href="/biens?page=0"');
  });

  it("dernière page : pas de lien suivant interactif", () => {
    const html = renderToStaticMarkup(<Pagination page={5} totalPages={5} construireHref={construireHref} />);
    expect(html).not.toContain("Suivant");
    expect(html).not.toContain('href="/biens?page=6"');
  });
});
