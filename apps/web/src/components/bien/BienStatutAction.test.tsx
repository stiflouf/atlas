import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import Badge from "@/components/ui/Badge";
import BienStatutAction from "./BienStatutAction";

function bienTest(surcharge: Partial<Bien> = {}): Bien {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    reference: "AXB-1042",
    titre: "Bel appartement",
    type: "appartement",
    adresse: "12 rue des Lilas",
    ville: "Lyon",
    codePostal: "69006",
    surface: 82,
    pieces: 4,
    prix: 485000,
    statutMandat: "actif",
    dateMandat: "2026-03-12",
    caracteristiques: [],
    description: "",
    ...surcharge,
  };
}

describe("BienStatutAction", () => {
  it("propose Marquer une offre en cours ET Marquer compromis signé quand aucun jalon n'est posé (mêmes conditions qu'avant ce chantier)", () => {
    const html = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest()}
        statutLabel={<Badge variant="default">En commercialisation</Badge>}
        dateMandatFormatee="12 mars 2026"
      />
    );
    expect(html).toContain("Marquer une offre en cours");
    expect(html).toContain("Marquer compromis signé");
    expect(html).not.toContain("Retirer l&#x27;offre");
    expect(html).not.toContain("Annuler le compromis");
  });

  it("propose Retirer l'offre et Marquer compromis signé quand une offre est en cours", () => {
    const html = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest({ offreEnCoursLe: "2026-08-01T00:00:00.000Z" })}
        statutLabel={<Badge variant="accent">Offre en cours</Badge>}
        dateMandatFormatee="12 mars 2026"
      />
    );
    expect(html).toContain("Retirer l");
    expect(html).toContain("Marquer compromis signé");
    expect(html).not.toContain("Marquer une offre en cours");
  });

  it("ne propose plus que Annuler le compromis une fois le compromis signé", () => {
    const html = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest({ offreEnCoursLe: "2026-08-01T00:00:00.000Z", compromisSigneLe: "2026-08-10T00:00:00.000Z" })}
        statutLabel={<Badge variant="success">Compromis signé</Badge>}
        dateMandatFormatee="12 mars 2026"
      />
    );
    expect(html).toContain("Annuler le compromis");
    expect(html).not.toContain("Marquer une offre en cours");
    expect(html).not.toContain("Marquer compromis signé");
    expect(html).not.toContain("Retirer l");
  });

  it("n'affiche aucune action de jalon pour un bien archivé ou mocké (mêmes gardes qu'avant ce chantier)", () => {
    const archive = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest({ archiveLe: "2026-08-01T00:00:00.000Z" })}
        statutLabel={<Badge variant="default">En commercialisation</Badge>}
        dateMandatFormatee="12 mars 2026"
      />
    );
    expect(archive).not.toContain("Marquer une offre en cours");

    const mock = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest({ id: "bien-001" })}
        statutLabel={<Badge variant="default">En commercialisation</Badge>}
        dateMandatFormatee="12 mars 2026"
      />
    );
    expect(mock).not.toContain("Marquer une offre en cours");
  });

  it("replie Modifier/Archiver/+Tâche/Préparer la visite sous « Voir toutes les actions »", () => {
    const html = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest()}
        statutLabel={<Badge variant="default">En commercialisation</Badge>}
        dateMandatFormatee="12 mars 2026"
        prochaineVisiteHref="/visites/v-1/preparer"
      />
    );
    expect(html).toContain("Voir toutes les actions");
    expect(html).toContain("Modifier le bien");
    expect(html).toContain("Archiver");
    expect(html).toContain("+ Ajouter une tâche");
    expect(html).toContain('href="/visites/v-1/preparer"');
  });

  it("affiche la raison de la tâche prioritaire réelle quand elle est fournie, sans texte inventé si absente", () => {
    const avecRaison = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest()}
        statutLabel={<Badge variant="default">En commercialisation</Badge>}
        dateMandatFormatee="12 mars 2026"
        raisonTacheTexte="Préparer le compromis avant le 30 mai"
      />
    );
    expect(avecRaison).toContain("Préparer le compromis avant le 30 mai");

    const sansRaison = renderToStaticMarkup(
      <BienStatutAction
        bien={bienTest()}
        statutLabel={<Badge variant="default">En commercialisation</Badge>}
        dateMandatFormatee="12 mars 2026"
      />
    );
    expect(sansRaison).not.toContain("Préparer le compromis");
  });
});
