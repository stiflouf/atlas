import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// DEMO_UX_HARDENING_V1 — gardes sur ce qui SE VOIT : un seul mot pour l'acquéreur, plus aucune
// marque héritée à l'écran, et des formulaires qui tiennent sur un téléphone. Ces vérifications
// portent sur le source rendu, jamais sur un style précis.
const SRC = join(__dirname, "..");
const lire = (chemin: string) => readFileSync(join(SRC, chemin), "utf8");

describe("Vocabulaire — « Acquéreurs » à l'écran, /clients dans l'URL", () => {
  const SURFACES = [
    "components/layout/NavItems.tsx",
    "app/clients/page.tsx",
    "app/clients/nouveau/page.tsx",
    "app/clients/[id]/page.tsx",
  ];

  it("les quatre surfaces corrigées n'affichent plus « Clients »", () => {
    for (const chemin of SURFACES) {
      const source = lire(chemin);
      const texteAffiche = source
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ")
        // Identifiants techniques conservés : routes, repository, variables, composants.
        .replace(/"\/clients[^"]*"/g, " ")
        .replace(/`\/clients[^`]*`/g, " ")
        .replace(/\b(listerClients|rechercherAcquereursPage|clientsDemo|aucunClientReel|clients|client|ClientsPage|FicheClient|clientRepository|clientsPage)\b/g, " ");
      expect(source, chemin).toContain("cquéreur");
      expect(texteAffiche, chemin).not.toMatch(/>\s*Clients\s*</);
      expect(texteAffiche, chemin).not.toMatch(/"Clients"/);
    }
  });

  it("la route /clients et le repository restent intacts : aucun renommage technique", () => {
    expect(lire("components/layout/NavItems.tsx")).toContain('href: "/clients"');
    expect(lire("app/clients/page.tsx")).toContain('from "@/lib/clientRepository"');
  });
});

describe("États vides /clients — chaque impasse propose le geste suivant", () => {
  const page = lire("app/clients/page.tsx");

  it("les trois branches passent par EmptyState avec un CTA", () => {
    expect(page).toContain('from "@/components/ui/EmptyState"');
    expect(page).toContain('libelle: "Effacer la recherche"');
    expect(page).toContain('libelle: "Voir les acquéreurs actifs"');
    expect(page).toContain('libelle: "Ajouter un acquéreur"');
    expect(page).toContain('href: "/clients/nouveau"');
    // Le texte de recherche attendu par app/clients/page.test.tsx est conservé.
    expect(page).toContain("Aucun résultat pour");
  });

  it("/contacts n'est pas touché par ce lot", () => {
    const contacts = lire("app/contacts/page.tsx");
    expect(contacts).toContain("Aucun contact trouvé.");
    expect(contacts).toContain("Aucun contact pour le moment.");
  });
});

describe("Branding — plus aucune marque héritée à l'écran", () => {
  it("le pack notaire ne rend plus « Préparation Atlas », et son état dérivé est renommé", () => {
    const packNotaire = lire("lib/documents/packNotaire.ts");
    expect(packNotaire).not.toContain("Préparation Atlas");
    expect(packNotaire).toContain("preparation_complete");
    expect(packNotaire).not.toContain("preparation_atlas_complete:");
    expect(lire("app/biens/[id]/pack-notaire/page.tsx")).toContain('"preparation_complete"');
  });

  it("aucune chaîne « Atlas » n'est affichée dans le JSX des écrans", () => {
    for (const chemin of ["lib/documents/packNotaire.ts", "app/biens/[id]/pack-notaire/page.tsx"]) {
      const sansCommentaire = lire(chemin).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
      expect(sansCommentaire, chemin).not.toMatch(/"[^"]*\bAtlas\b[^"]*"/);
    }
  });

  it("les références d'exemple proposées au conseiller ne portent plus le préfixe ATL", () => {
    for (const chemin of ["components/bien/BienFormulaire.tsx", "components/prospectVendeur/ProspectVendeurConversionFormulaire.tsx"]) {
      expect(lire(chemin), chemin).toContain('placeholder="DOM-2026-001"');
      expect(lire(chemin), chemin).not.toContain("ATL-");
    }
  });
});

describe("Formulaires — une colonne sur téléphone", () => {
  it("les quatre grilles à trois colonnes s'empilent avant le breakpoint", () => {
    for (const [chemin, attendu] of [
      ["components/bien/BienFormulaire.tsx", "grid-cols-1 sm:grid-cols-3"],
      ["components/prospectVendeur/ProspectVendeurConversionFormulaire.tsx", "grid-cols-1 sm:grid-cols-3"],
      // Trois <select> aux libellés longs : deux colonnes resteraient illisibles, d'où md:.
      ["components/tache/CibleTacheSelecteur.tsx", "grid-cols-1 md:grid-cols-3"],
      ["components/fiscal/RfrFoyerFormulaire.tsx", "grid-cols-1 sm:grid-cols-3"],
    ] as const) {
      const source = lire(chemin);
      expect(source, chemin).toContain(attendu);
      expect(source.replace(/grid-cols-1 (sm|md):grid-cols-3/g, " "), chemin).not.toMatch(/\bgrid-cols-3\b/);
    }
  });
});
