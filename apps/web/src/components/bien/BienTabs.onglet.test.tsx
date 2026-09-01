import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bien } from "@/types/bien";
import type { Tache } from "@/types/tache";
import type { NoteBien } from "@/types/noteBien";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import type { DocumentBien } from "@/types/documentBien";
import type { Offre } from "@/types/offre";
import type { Compromis } from "@/types/compromis";
import { LABEL_REGLE_AUTOMATISATION } from "@/lib/automatisations/catalogueRegles";
import { getTabId } from "@/components/ui/Tabs";
import BienTabs from "./BienTabs";
import { ongletBienValide, type OngletBien } from "@/types/ongletBien";

// DEMO-DOCS-UX-01 — l'onglet actif vivait uniquement dans un useState client : toute mutation
// documentaire se terminant par redirect() renvoyait le conseiller sur "Contexte", au milieu d'une
// série d'ajouts de pièces. L'onglet d'ouverture vient désormais de l'URL, validé côté serveur.

function bienTest(): Bien {
  return {
    id: "bien-test",
    reference: "TEST-001",
    titre: "Bien de test",
    type: "appartement",
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 300000,
    statutMandat: "actif",
    dateMandat: "2026-01-01",
    caracteristiques: [],
    description: "",
  };
}

function rendre(ongletInitial?: OngletBien): string {
  return renderToStaticMarkup(
    <BienTabs
      bien={bienTest()}
      taches={[] as Tache[]}
      notes={[] as NoteBien[]}
      comptesRendus={[] as CompteRenduVisite[]}
      documents={[] as DocumentBien[]}
      offres={[] as Offre[]}
      compromis={[] as Compromis[]}
      labelRegleAutomatisation={LABEL_REGLE_AUTOMATISATION}
      ongletInitial={ongletInitial}
    />
  );
}

// L'onglet actif porte aria-selected="true" (Tabs.tsx) — on lit l'attribut réellement rendu
// plutôt qu'une classe de style, qui changerait au premier ajustement visuel.
function ongletActif(html: string, onglet: string): boolean {
  const idTab = getTabId("bien-tabs", onglet);
  const balise = [...html.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).find((b) => b.includes(`id="${idTab}"`));
  return balise !== undefined && balise.includes('aria-selected="true"');
}

describe("ongletBienValide — validation du paramètre d'URL", () => {
  it("accepte les onglets connus", () => {
    expect(ongletBienValide("documents")).toBe("documents");
    expect(ongletBienValide("compromis")).toBe("compromis");
  });

  it("retombe sur contexte quand le paramètre est absent", () => {
    expect(ongletBienValide(undefined)).toBe("contexte");
  });

  it("retombe sur contexte pour une valeur inconnue, jamais une fiche sans onglet actif", () => {
    expect(ongletBienValide("nimportequoi")).toBe("contexte");
    expect(ongletBienValide("")).toBe("contexte");
  });
});

describe("BienTabs — onglet d'ouverture", () => {
  it("sans paramètre : Contexte reste l'onglet par défaut", () => {
    const html = rendre();
    expect(ongletActif(html, "contexte")).toBe(true);
    expect(ongletActif(html, "documents")).toBe(false);
  });

  it("ongletInitial=documents : Documents est l'onglet actif", () => {
    const html = rendre("documents");
    expect(ongletActif(html, "documents")).toBe(true);
    expect(ongletActif(html, "contexte")).toBe(false);
  });
});

// Test structurel sur le source, même patron que gardeSessionAtlas.structurel.test.ts : ce qui
// compte est la DESTINATION de la redirection, pas le rendu. La vérifier par lecture du fichier
// évite de remonter toute la chaîne repositories/stockage pour un contrôle d'URL.
describe("mutations documentaires — destination après succès", () => {
  const source = readFileSync(join(__dirname, "..", "..", "actions", "ajouterDocumentBien.ts"), "utf8");

  it("ajout et correction ramènent tous deux sur l'onglet Documents", () => {
    const redirections = [...source.matchAll(/redirect\(`([^`]+)`\)/g)].map((m) => m[1]);

    expect(redirections).toHaveLength(2);
    for (const destination of redirections) {
      expect(destination).toBe("/biens/${bienId}?onglet=documents");
    }
  });

  it("aucune mutation documentaire ne renvoie plus sur la fiche sans onglet", () => {
    expect(source).not.toContain("redirect(`/biens/${bienId}`)");
  });
});
