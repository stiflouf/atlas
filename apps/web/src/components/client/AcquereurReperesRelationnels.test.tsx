import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AcquereurReperesRelationnels from "./AcquereurReperesRelationnels";

const ACQUEREUR_ID = "550e8400-e29b-41d4-a716-446655440000";

function markupFormulaireAjout(): string {
  return renderToStaticMarkup(
    <AcquereurReperesRelationnels
      acquereurId={ACQUEREUR_ID}
      reperesInitiaux={[]}
      reperesArchives={[]}
      archive={false}
    />
  );
}

// Extrait la balise ouvrante d'un champ du formulaire d'AJOUT (suffixe `nouveau`), pour raisonner
// sur ses attributs plutôt que sur le document entier.
function baliseChamp(html: string, marqueur: string): string {
  const debut = html.indexOf(marqueur);
  expect(debut).toBeGreaterThan(-1);
  const ouverture = html.lastIndexOf("<input", debut);
  return html.slice(ouverture, html.indexOf(">", debut) + 1);
}

describe("AcquereurReperesRelationnels — formulaire d'ajout", () => {
  it("le champ information est vide : aucune valeur préremplie, seulement un exemple", () => {
    const champ = baliseChamp(markupFormulaireAjout(), 'id="libelle-nouveau"');

    // Le placeholder de la demo (« Préfère les échanges par email ») était rédigé comme un vrai
    // repère et a été lu comme une saisie déjà faite : le préfixe « Ex. : » est ce qui distingue
    // un exemple d'une valeur.
    expect(champ).toContain('placeholder="Ex. : ');
    expect(champ).toContain('value=""');
  });

  it("le champ information est requis côté navigateur — garde-fou de saisie, pas la sécurité", () => {
    expect(baliseChamp(markupFormulaireAjout(), 'id="libelle-nouveau"')).toContain("required");
  });

  it("le libellé du champ nomme ce qui est attendu", () => {
    expect(markupFormulaireAjout()).toContain("Information à retenir");
  });

  it("la case d'autorisation est décochée pour un nouveau repère", () => {
    const champ = baliseChamp(markupFormulaireAjout(), 'name="utilisableCommunication"');

    expect(champ).toContain('type="checkbox"');
    expect(champ).not.toContain("checked");
  });

  it("la longueur maximale reste celle du type, jamais une seconde vérité dans le composant", () => {
    expect(baliseChamp(markupFormulaireAjout(), 'id="libelle-nouveau"')).toContain('maxLength="200"');
  });
});
