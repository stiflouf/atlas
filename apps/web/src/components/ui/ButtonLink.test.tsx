import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ButtonLink from "./ButtonLink";

describe("ButtonLink", () => {
  it("rend un vrai lien, avec le href correct, jamais un bouton descendant", () => {
    const html = renderToStaticMarkup(
      <ButtonLink href="/biens/nouveau" variant="primary" size="md">
        Ajouter un bien
      </ButtonLink>
    );
    expect(html).toContain('href="/biens/nouveau"');
    expect(html).not.toContain("<button");
    expect(html).toContain("Ajouter un bien");
  });
});
