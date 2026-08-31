import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ErreurApplication from "./error";
import ErreurGlobale from "./global-error";
import PageIntrouvable from "./not-found";

// Message volontairement reconnaissable : sert à prouver qu'il ne fuit JAMAIS vers l'écran, quelle
// que soit la frontière. Une erreur serveur peut porter un détail technique ou une donnée métier.
const MESSAGE_SENSIBLE = "connexion refusée sur postgres://atlas@interne";

function erreurFactice(digest?: string): Error & { digest?: string } {
  const erreur = new Error(MESSAGE_SENSIBLE) as Error & { digest?: string };
  erreur.digest = digest;
  return erreur;
}

describe("error.tsx — frontière d'erreur de segment", () => {
  it("rend le titre et le texte de récupération", () => {
    const html = renderToStaticMarkup(<ErreurApplication error={erreurFactice()} reset={() => {}} />);
    expect(html).toContain("<h1");
    expect(html).toContain("Une erreur est survenue");
    expect(html).toContain("Vous pouvez réessayer");
  });

  it("offre un vrai bouton Réessayer et une sortie vers l'accueil", () => {
    const html = renderToStaticMarkup(<ErreurApplication error={erreurFactice()} reset={() => {}} />);
    expect(html).toContain("<button");
    expect(html).toContain("Réessayer");
    expect(html).toContain('href="/"');
  });

  it("affiche le digest quand il existe, sous la formulation attendue", () => {
    const html = renderToStaticMarkup(<ErreurApplication error={erreurFactice("a1b2c3d4")} reset={() => {}} />);
    expect(html).toContain("Référence technique");
    expect(html).toContain("a1b2c3d4");
  });

  it("n'invente jamais de référence quand le digest est absent", () => {
    const html = renderToStaticMarkup(<ErreurApplication error={erreurFactice()} reset={() => {}} />);
    expect(html).not.toContain("Référence technique");
  });

  it("ne rend jamais le message brut de l'erreur", () => {
    const html = renderToStaticMarkup(<ErreurApplication error={erreurFactice("a1b2c3d4")} reset={() => {}} />);
    expect(html).not.toContain(MESSAGE_SENSIBLE);
    expect(html).not.toContain("postgres://");
  });
});

describe("global-error.tsx — dernier filet", () => {
  // Remplace le Root Layout : sans <html>/<body>, Next.js ne peut rien rendre du tout au moment
  // exact où cet écran est le seul recours.
  it("fournit bien son propre document (html + body)", () => {
    const html = renderToStaticMarkup(<ErreurGlobale error={erreurFactice()} reset={() => {}} />);
    expect(html).toContain("<html");
    expect(html).toContain('lang="fr"');
    expect(html).toContain("<body");
  });

  it("rend le titre et un vrai bouton Réessayer", () => {
    const html = renderToStaticMarkup(<ErreurGlobale error={erreurFactice()} reset={() => {}} />);
    expect(html).toContain("<h1");
    expect(html).toContain("Une erreur est survenue");
    expect(html).toContain("<button");
    expect(html).toContain("Réessayer");
  });

  it("affiche le digest s'il existe, jamais le message brut", () => {
    const html = renderToStaticMarkup(<ErreurGlobale error={erreurFactice("e5f6a7b8")} reset={() => {}} />);
    expect(html).toContain("Référence technique");
    expect(html).toContain("e5f6a7b8");
    expect(html).not.toContain(MESSAGE_SENSIBLE);
  });

  // Le Root Layout n'est pas rendu quand cette frontière l'est : cet écran ne doit dépendre
  // d'aucune classe utilitaire ni variable de thème pour rester lisible.
  it("ne dépend d'aucune classe utilitaire pour son rendu", () => {
    const html = renderToStaticMarkup(<ErreurGlobale error={erreurFactice()} reset={() => {}} />);
    expect(html).not.toContain("class=");
  });
});

describe("not-found.tsx — 404 produit", () => {
  it("rend le titre, l'explication et un retour vers l'accueil", () => {
    const html = renderToStaticMarkup(<PageIntrouvable />);
    expect(html).toContain("<h1");
    expect(html).toContain("Page introuvable");
    expect(html).toContain("est plus disponible");
    expect(html).toContain('href="/"');
    expect(html).toContain("Retour à l");
  });
});
