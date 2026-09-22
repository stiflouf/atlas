import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FormulaireAvecEtat from "./FormulaireAvecEtat";
import BoutonSoumettre from "./BoutonSoumettre";
import type { EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

const action = async (): Promise<EtatFormulaire> => ({ statut: "idle" });

// Rendu serveur : useActionState rend l'état initial (aucune alerte), useFormStatus rend
// pending=false (bouton actif). L'état "erreur"/"pending" est un comportement client couvert par
// le smoke Playwright ; ici on verrouille la structure : form, champs conservés, alerte absente au
// départ, bouton submit natif, prop `disabled` respectée.
describe("FormulaireAvecEtat", () => {
  it("rend un <form> autour des champs de l'appelant, sans alerte à l'état initial", () => {
    const html = renderToStaticMarkup(
      <FormulaireAvecEtat action={action} className="flex flex-col gap-4">
        <input name="titre" defaultValue="Relancer" />
        <BoutonSoumettre libelleAttente="Création…">Créer</BoutonSoumettre>
      </FormulaireAvecEtat>
    );
    expect(html).toMatch(/^<form class="flex flex-col gap-4"/);
    expect(html).toContain('name="titre"');
    expect(html).toContain('value="Relancer"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('type="submit"');
    expect(html).toContain(">Créer<");
    expect(html).not.toContain("Création…");
    // Les classes `disabled:` de Button sont présentes ; l'attribut, lui, ne l'est pas hors pending.
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
  });
});

describe("BoutonSoumettre", () => {
  it("classeBrute : bouton natif submit conservant les classes existantes", () => {
    const html = renderToStaticMarkup(
      <form>
        <BoutonSoumettre classeBrute="btn-x" libelleAttente="Signature…">Signer</BoutonSoumettre>
      </form>
    );
    expect(html).toContain('<button type="submit" class="btn-x disabled:opacity-50 disabled:cursor-not-allowed">Signer</button>');
  });

  it("disabled métier : bouton désactivé même hors pending", () => {
    const html = renderToStaticMarkup(
      <form>
        <BoutonSoumettre disabled>Créer</BoutonSoumettre>
      </form>
    );
    expect(html).toMatch(/<button[^>]*\sdisabled=""/);
  });
});
