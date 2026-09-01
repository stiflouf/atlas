import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import type { Tache } from "@/types/tache";
import type { NoteBien } from "@/types/noteBien";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { DocumentBien } from "@/types/documentBien";
import type { Offre } from "@/types/offre";
import type { Compromis } from "@/types/compromis";
import { LABEL_REGLE_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import BienTabs from "./BienTabs";

// DEMO-DOCS-UX-02 — le formulaire de correction n'avait aucun libellé visible : deux champs date
// nus côte à côte et un champ texte nu au-dessus. Un conseiller a saisi « Date du document :
// 31/08/2026 Fin de validité : 31/08/2036 » dans le champ Nom d'un document, et sa correction de
// dates est partie dans le mauvais champ. Ces tests figent les libellés, le préremplissage et la
// séparation d'un document au suivant.

function bienTest(): Bien {
  return {
    id: "bien-test",
    reference: "TEST-001",
    titre: "Bien de test",
    type: "maison",
    adresse: "3 allée des Charmes",
    ville: "Maisons-Laffitte",
    codePostal: "78600",
    surface: 128,
    pieces: 5,
    prix: 745000,
    statutMandat: "actif",
    dateMandat: "2026-05-01",
    caracteristiques: [],
    description: "",
  };
}

function documentTest(surcharge: Partial<DocumentBien> = {}): DocumentBien {
  return {
    id: "doc-1",
    bienId: "bien-test",
    nom: "DPE Olivier Reynal",
    categorie: "diagnostic",
    nomFichierOriginal: "dpe.pdf",
    cleStockage: "cle-1",
    tailleOctets: 12345,
    typeMime: "application/pdf",
    creeLe: "2026-08-31T10:00:00.000Z",
    typeDocument: "dpe",
    etatVerification: "non_verifie",
    ...surcharge,
  };
}

function rendreDocuments(documents: DocumentBien[]): string {
  return renderToStaticMarkup(
    <BienTabs
      bien={bienTest()}
      taches={[] as Tache[]}
      notes={[] as NoteBien[]}
      comptesRendus={[] as CompteRenduVisite[]}
      documents={documents}
      offres={[] as Offre[]}
      compromis={[] as Compromis[]}
      labelRegleAutomatisation={LABEL_REGLE_AUTOMATISATION}
      ongletInitial="documents"
    />
  );
}

// Le formulaire de correction d'un document donné, isolé par son aria-label — c'est lui qui
// rattache le formulaire à SON document, et il permet de vérifier qu'un champ prérempli appartient
// bien au bon document.
function formulaireCorrection(html: string, nomDocument: string): string {
  const debut = html.indexOf(`aria-label="Corriger le classement de ${nomDocument}"`);
  expect(debut).toBeGreaterThan(-1);
  const fin = html.indexOf("</form>", debut);
  return html.slice(debut, fin);
}

describe("BienTabs — formulaire de correction documentaire", () => {
  const LIBELLES_ATTENDUS = [
    "Nom du document",
    "Catégorie",
    "Type",
    "Date du document",
    "Fin de validité",
    "Rattachement",
    "État de vérification",
  ];

  it("affiche un libellé visible pour chaque champ corrigible", () => {
    const formulaire = formulaireCorrection(rendreDocuments([documentTest()]), "DPE Olivier Reynal");
    for (const libelle of LIBELLES_ATTENDUS) {
      expect(formulaire).toContain(libelle);
    }
  });

  it("annonce sous Fin de validité à quoi la date sert, rattachée au champ par aria-describedby", () => {
    const formulaire = formulaireCorrection(rendreDocuments([documentTest()]), "DPE Olivier Reynal");

    expect(formulaire).toContain('aria-describedby="aide-fin-validite-doc-1"');
    expect(formulaire).toContain('id="aide-fin-validite-doc-1"');
    expect(formulaire).toContain("Utilisée pour déterminer si un diagnostic est encore valide.");
  });

  it("préremplit les champs avec les valeurs actuelles du document", () => {
    const formulaire = formulaireCorrection(
      rendreDocuments([documentTest({ dateDocument: "2026-08-31", dateFinValidite: "2026-08-31" })]),
      "DPE Olivier Reynal"
    );

    expect(formulaire).toContain('name="nom"');
    expect(formulaire).toContain('value="DPE Olivier Reynal"');
    expect(formulaire).toContain('name="dateFinValidite"');
    expect(formulaire).toContain('value="2026-08-31"');
    expect(formulaire).toContain('value="bien-test"');
  });

  it("préremplit le champ Nom avec le nom exact du document, même aberrant", () => {
    const nomAberrant = "Date du document : 31/08/2026 Fin de validité : 31/08/2036";
    const html = rendreDocuments([documentTest({ id: "doc-mandat", nom: nomAberrant, typeDocument: "mandat" })]);
    const formulaire = formulaireCorrection(html, nomAberrant);

    expect(formulaire).toContain(`value="${nomAberrant}"`);
  });

  it("rattache chaque formulaire à son propre document, sans mélanger les valeurs", () => {
    const html = rendreDocuments([
      documentTest({ id: "doc-dpe", nom: "DPE Olivier Reynal", dateFinValidite: "2026-08-31" }),
      documentTest({
        id: "doc-mandat",
        nom: "Mandat de vente",
        categorie: "mandat",
        typeDocument: "mandat",
        dateFinValidite: "2030-01-01",
      }),
    ]);

    const dpe = formulaireCorrection(html, "DPE Olivier Reynal");
    const mandat = formulaireCorrection(html, "Mandat de vente");

    expect(dpe).toContain('value="doc-dpe"');
    expect(dpe).toContain('value="2026-08-31"');
    expect(dpe).not.toContain('value="2030-01-01"');

    expect(mandat).toContain('value="doc-mandat"');
    expect(mandat).toContain('value="2030-01-01"');
    expect(mandat).not.toContain('value="2026-08-31"');
  });

  // VALIDITÉ-01 — la suggestion de date DPE est un préremplissage, jamais une contrainte : le champ
  // « Fin de validité » ne devient ni readonly ni disabled, et l'aide DPE n'apparaît que pour un DPE.
  it("laisse « Fin de validité » librement modifiable, jamais verrouillée par la suggestion", () => {
    const formulaire = formulaireCorrection(
      rendreDocuments([documentTest({ dateDocument: "2026-09-01", dateFinValidite: "2036-08-31" })]),
      "DPE Olivier Reynal"
    );
    const champ = /<input[^>]*name="dateFinValidite"[^>]*>/.exec(formulaire)?.[0] ?? "";

    expect(champ).toContain('value="2036-08-31"');
    expect(champ).not.toContain("readonly");
    expect(champ).not.toContain("disabled");
  });

  it("affiche l'aide DPE sur un DPE, et la garde masquée pour un autre type de document", () => {
    const html = rendreDocuments([
      documentTest({ id: "doc-dpe", nom: "DPE Olivier Reynal", typeDocument: "dpe" }),
      documentTest({ id: "doc-amiante", nom: "Diagnostic amiante", typeDocument: "amiante" }),
    ]);

    const dpe = formulaireCorrection(html, "DPE Olivier Reynal");
    const amiante = formulaireCorrection(html, "Diagnostic amiante");

    expect(/<p data-aide-dpe=""(?! hidden)/.test(dpe)).toBe(true);
    expect(dpe).toContain("généralement valable 10 ans");
    expect(/<p data-aide-dpe="" hidden/.test(amiante)).toBe(true);
  });

  it("sépare visuellement chaque document dans sa propre carte, jamais un seul long formulaire", () => {
    const html = rendreDocuments([
      documentTest({ id: "doc-dpe", nom: "DPE Olivier Reynal" }),
      documentTest({ id: "doc-mandat", nom: "Mandat de vente" }),
    ]);

    // Deux formulaires distincts, chacun avec son bouton d'enregistrement.
    expect([...html.matchAll(/aria-label="Corriger le classement de /g)]).toHaveLength(2);
    expect([...html.matchAll(/Enregistrer la correction/g)]).toHaveLength(2);

    // Le nom du document est rendu avant le formulaire qui le corrige.
    const positionNom = html.indexOf("DPE Olivier Reynal");
    const positionFormulaire = html.indexOf('aria-label="Corriger le classement de DPE Olivier Reynal"');
    expect(positionNom).toBeLessThan(positionFormulaire);
  });
});
