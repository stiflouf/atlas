import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Button from "./Button";

describe("Button", () => {
  it('type="button" par défaut', () => {
    const html = renderToStaticMarkup(<Button>Valider</Button>);
    expect(html).toContain('type="button"');
  });

  it('type="submit" respecté lorsqu\'il est fourni explicitement', () => {
    const html = renderToStaticMarkup(<Button type="submit">Envoyer</Button>);
    expect(html).toContain('type="submit"');
  });

  it("disabled explicite reste respecté", () => {
    const html = renderToStaticMarkup(<Button disabled>Valider</Button>);
    expect(html).toContain(' disabled=""');
  });

  it("loading=false n'impose pas disabled", () => {
    const html = renderToStaticMarkup(<Button loading={false}>Valider</Button>);
    expect(html).not.toContain(' disabled=""');
  });

  it("loading=true désactive le bouton, porte aria-busy, et garde les children visibles", () => {
    const html = renderToStaticMarkup(<Button loading>Enregistrer</Button>);
    expect(html).toContain(' disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Enregistrer");
  });

  it("loading=true reste autoritaire même si le consommateur fournit un aria-busy contradictoire", () => {
    // Ne vérifie pas la sous-chaîne "disabled" seule : elle apparaît toujours dans la classe
    // Tailwind `disabled:opacity-50 disabled:cursor-not-allowed`, qu'il soit réellement actif ou non.
    const html = renderToStaticMarkup(
      <Button loading aria-busy="false">
        Enregistrer
      </Button>
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('aria-busy="false"');
    expect(html).toContain(' disabled=""');
  });
});
