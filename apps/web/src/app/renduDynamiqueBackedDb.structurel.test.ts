import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";

// Bugfix pilote (déploiement Railway) — /automatisations interrogeait Postgres au rendu sans
// `export const dynamic = "force-dynamic"` ni segment de route dynamique : Next.js la pré-générait
// donc au `next build`, qui échouait dès que la DB n'était pas joignable à cet instant (réseau privé
// Railway, disponible seulement au runtime). Ce test structurel (AST réel, pas un grep textuel qui
// pourrait être trompé par un import inutilisé) garantit que ce défaut de classe ne peut plus revenir
// silencieusement : toute page sous une route STATIQUE (sans segment `[..]`) qui importe un
// repository DB doit soit déclarer `export const dynamic = "force-dynamic"`, soit dépendre d'une
// primitive Next qui force déjà le rendu dynamique (`searchParams`, seule utilisée aujourd'hui —
// voir communications/nouveau/page.tsx).

const DOSSIER_APP = join(__dirname);

function listerPagesRecursivement(dossier: string): string[] {
  const fichiers: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) {
      fichiers.push(...listerPagesRecursivement(chemin));
    } else if (entree === "page.tsx") {
      fichiers.push(chemin);
    }
  }
  return fichiers;
}

// Segment `[...]` n'importe où dans le chemin de route ⇒ Next.js ne pré-génère jamais cette page au
// build en l'absence de `generateStaticParams` (aucune n'existe dans ce projet, vérifié ci-dessous) —
// elle est automatiquement rendue à la requête, hors périmètre de cette garantie.
function estRouteStatique(cheminAbsolu: string): boolean {
  return !relative(DOSSIER_APP, cheminAbsolu).includes("[");
}

function importeUnRepositoryDb(sourceFile: ts.SourceFile): boolean {
  let trouve = false;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (/Repository$/.test(statement.moduleSpecifier.text)) trouve = true;
  }
  return trouve;
}

function declareDynamicForceDynamic(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const estExportee = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!estExportee) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "dynamic" &&
        declaration.initializer &&
        ts.isStringLiteral(declaration.initializer) &&
        declaration.initializer.text === "force-dynamic"
      ) {
        return true;
      }
    }
  }
  return false;
}

// Seule autre primitive utilisée aujourd'hui dans ce projet pour forcer le rendu dynamique sans le
// flag explicite (communications/nouveau/page.tsx) — Next.js bascule automatiquement une page qui
// lit `searchParams` en rendu à la requête, jamais pré-générée au build.
function utiliseSearchParams(sourceFile: ts.SourceFile): boolean {
  return /searchParams/.test(sourceFile.text);
}

describe("Pages DB-backed sur route statique — opt-in dynamique obligatoire (bugfix build Railway)", () => {
  const pages = listerPagesRecursivement(DOSSIER_APP);

  it("découvre bien des pages sous src/app (le test n'est pas vide)", () => {
    expect(pages.length).toBeGreaterThan(15);
  });

  const pagesStatiquesDbBacked = pages.filter((chemin) => {
    if (!estRouteStatique(chemin)) return false;
    const contenu = readFileSync(chemin, "utf8");
    const sourceFile = ts.createSourceFile(chemin, contenu, ts.ScriptTarget.Latest, true);
    return importeUnRepositoryDb(sourceFile);
  });

  it("au moins une page statique DB-backed existe (le test couvre un cas réel)", () => {
    expect(pagesStatiquesDbBacked.length).toBeGreaterThan(0);
  });

  it.each(pagesStatiquesDbBacked.map((chemin) => [relative(DOSSIER_APP, chemin), chemin] as const))(
    "%s : force-dynamic ou searchParams (jamais interrogée au build)",
    (_route, chemin) => {
      const contenu = readFileSync(chemin, "utf8");
      const sourceFile = ts.createSourceFile(chemin, contenu, ts.ScriptTarget.Latest, true);
      const protegee = declareDynamicForceDynamic(sourceFile) || utiliseSearchParams(sourceFile);
      expect(protegee, `${relative(DOSSIER_APP, chemin)} lit un repository DB sur une route statique sans opt-in dynamique`).toBe(true);
    }
  );
});
