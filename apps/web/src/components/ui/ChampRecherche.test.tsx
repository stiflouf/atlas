import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ChampRecherche from "./ChampRecherche";

describe("ChampRecherche (ADR-048)", () => {
  it("reste un vrai formulaire GET, jamais interceptable par du JS", () => {
    const html = renderToStaticMarkup(
      <ChampRecherche action="/biens" q="Annecy" placeholder="Rechercher" hrefEffacer="/biens" />
    );
    expect(html).toContain('method="GET"');
    expect(html).toContain('action="/biens"');
  });

  it("le champ q se trouve dans le formulaire, avec sa valeur initiale reflétée", () => {
    const html = renderToStaticMarkup(
      <ChampRecherche action="/biens" q="Annecy" placeholder="Rechercher" hrefEffacer="/biens" />
    );
    expect(html).toContain('name="q"');
    expect(html).toContain('value="Annecy"');
  });

  it("préserve les paramètres déjà actifs via des champs cachés", () => {
    const html = renderToStaticMarkup(
      <ChampRecherche
        action="/biens"
        placeholder="Rechercher"
        hrefEffacer="/biens"
        champsCaches={{ archives: "1" }}
      />
    );
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="archives"');
    expect(html).toContain('value="1"');
  });
});
