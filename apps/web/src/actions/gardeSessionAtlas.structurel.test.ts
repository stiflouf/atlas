import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import ts from "typescript";

// ADR-047, §22 — garantie structurelle : "le fichier importe exigerSessionAtlas" ne suffit pas (un
// seul import peut masquer plusieurs fonctions non protégées). Ce test parse réellement l'AST
// TypeScript de chaque fichier "use server" (compilateur déjà présent dans le projet, aucune
// dépendance supplémentaire) et vérifie que CHAQUE fonction exportée commence par
// `await exigerSessionAtlas();` — jamais un simple contrôle textuel/grep qui pourrait être trompé
// par un import inutilisé ou un appel placé après une première mutation.
//
// Doit échouer si demain quelqu'un ajoute une nouvelle Server Action sans cette garde en première
// ligne — c'est précisément ce que ce test protège.

const DOSSIER_ACTIONS = join(__dirname);

function estFichierActionSource(nomFichier: string): boolean {
  return nomFichier.endsWith(".ts") && !nomFichier.endsWith(".test.ts");
}

function estDirectiveUseServer(sourceFile: ts.SourceFile): boolean {
  const premiereInstruction = sourceFile.statements[0];
  return (
    premiereInstruction !== undefined &&
    ts.isExpressionStatement(premiereInstruction) &&
    ts.isStringLiteral(premiereInstruction.expression) &&
    premiereInstruction.expression.text === "use server"
  );
}

// Corps en bloc uniquement (fonction/méthode "classique") : un corps expression seule (arrow
// function sans accolades, ex. `export const foo = async () => bar()`) est structurellement
// incapable de contenir `exigerSessionAtlas()` comme première INSTRUCTION d'une suite — traité
// comme non protégé s'il apparaît, quel que soit son contenu.
function corpsAppelleExigerSessionAtlasEnPremier(corps: ts.Block | undefined): boolean {
  const premiereInstruction = corps?.statements[0];
  if (!premiereInstruction || !ts.isExpressionStatement(premiereInstruction)) return false;

  let expression = premiereInstruction.expression;
  // `await exigerSessionAtlas();` — l'expression de tête est un AwaitExpression enveloppant l'appel.
  if (ts.isAwaitExpression(expression)) expression = expression.expression;

  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "exigerSessionAtlas"
  );
}

type FonctionNonProtegee = { fichier: string; fonction: string };
type FonctionExporteeDetectee = { nom: string; corps: ts.Block | undefined };

// Repère toutes les fonctions async exportées de niveau statement, quelle que soit leur syntaxe —
// une seule syntaxe couverte laisserait un angle mort structurel à la garantie :
// - `export async function foo() {}` (déclaration nommée, syntaxe historique du projet) ;
// - `export default async function foo() {}` / `export default async function () {}` (export
//   par défaut, nommé ou anonyme) ;
// - `export const foo = async () => {}` (arrow function à corps bloc) ;
// - `export const foo = async function () {}` (function expression).
function collecterFonctionsExporteesDuFichier(sourceFile: ts.SourceFile): FonctionExporteeDetectee[] {
  const fonctions: FonctionExporteeDetectee[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const estExportee = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!estExportee) continue;
      const estDefaut = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
      fonctions.push({ nom: statement.name?.text ?? (estDefaut ? "export default (anonyme)" : "(anonyme)"), corps: statement.body });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const estExportee = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!estExportee) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const init = declaration.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          fonctions.push({ nom: declaration.name.text, corps: ts.isBlock(init.body) ? init.body : undefined });
        }
      }
    }
  }

  return fonctions;
}

function trouverFonctionsExporteesNonProtegeesDansSource(fichier: string, sourceFile: ts.SourceFile): FonctionNonProtegee[] {
  const nonProtegees: FonctionNonProtegee[] = [];
  for (const { nom, corps } of collecterFonctionsExporteesDuFichier(sourceFile)) {
    if (!corpsAppelleExigerSessionAtlasEnPremier(corps)) {
      nonProtegees.push({ fichier, fonction: nom });
    }
  }
  return nonProtegees;
}

function trouverFonctionsExporteesNonProtegees(fichier: string): FonctionNonProtegee[] {
  const chemin = join(DOSSIER_ACTIONS, fichier);
  const contenu = readFileSync(chemin, "utf8");
  const sourceFile = ts.createSourceFile(chemin, contenu, ts.ScriptTarget.Latest, true);

  // Un fichier "use server" sans directive n'est pas une Server Action Next.js réelle — hors
  // périmètre de cette garantie (aucun fichier de ce type n'existe aujourd'hui sous src/actions/,
  // mais ce test ne doit jamais le supposer silencieusement).
  if (!estDirectiveUseServer(sourceFile)) {
    throw new Error(`${fichier} ne commence pas par la directive "use server" — fichier inattendu sous src/actions/.`);
  }

  return trouverFonctionsExporteesNonProtegeesDansSource(fichier, sourceFile);
}

describe("Garde de session Atlas — couverture exhaustive des Server Actions (ADR-047)", () => {
  const fichiers = readdirSync(DOSSIER_ACTIONS).filter(estFichierActionSource);

  it("découvre bien des fichiers Server Action sous src/actions/ (le test n'est pas vide)", () => {
    expect(fichiers.length).toBeGreaterThan(20);
  });

  it.each(fichiers)("%s : chaque fonction exportée commence par await exigerSessionAtlas()", (fichier) => {
    const nonProtegees = trouverFonctionsExporteesNonProtegees(fichier);
    expect(
      nonProtegees,
      `Fonctions exportées sans garde exigerSessionAtlas() en première ligne : ${nonProtegees
        .map((f) => `${f.fichier}#${f.fonction}`)
        .join(", ")}`
    ).toEqual([]);
  });
});

// Passe de fermeture ADR-047, point n°4 : la détection ci-dessus ne couvrait auparavant que
// `export async function foo() {}` (ts.isFunctionDeclaration) — un futur `export const foo =
// async () => {}` échappait silencieusement à la garantie. Ces cas positifs/négatifs synthétiques
// (sources TypeScript en chaîne, aucun fichier fixture réel créé sous src/actions/) démontrent que
// chaque syntaxe désormais prise en charge est correctement classée protégée ou non protégée.
function nonProtegeesPourSource(code: string): FonctionNonProtegee[] {
  const sourceFile = ts.createSourceFile("synthetique.ts", code, ts.ScriptTarget.Latest, true);
  return trouverFonctionsExporteesNonProtegeesDansSource("synthetique.ts", sourceFile);
}

describe("Détection AST — syntaxes d'export couvertes (garde-fou du garde-fou)", () => {
  it.each([
    ["export async function foo() {}", "export async function foo() { await exigerSessionAtlas(); return 1; }"],
    ["export const foo = async () => {} (arrow, corps bloc)", "export const foo = async () => { await exigerSessionAtlas(); return 1; };"],
    [
      "export const foo = async function () {} (function expression)",
      "export const foo = async function () { await exigerSessionAtlas(); return 1; };",
    ],
    [
      "export default async function foo() {} (export par défaut nommé)",
      "export default async function foo() { await exigerSessionAtlas(); return 1; }",
    ],
    [
      "export default async function () {} (export par défaut anonyme)",
      "export default async function () { await exigerSessionAtlas(); return 1; }",
    ],
  ])("%s : détectée comme protégée", (_libelle, code) => {
    expect(nonProtegeesPourSource(code)).toEqual([]);
  });

  it.each([
    [
      "export const nouvelleAction = async () => {} (arrow, corps bloc, sans garde)",
      "export const nouvelleAction = async () => { return 1; };",
      "nouvelleAction",
    ],
    [
      "export const nouvelleAction = async function () {} (function expression, sans garde)",
      "export const nouvelleAction = async function () { return 1; };",
      "nouvelleAction",
    ],
    [
      "export default async function () {} (export par défaut anonyme, sans garde)",
      "export default async function () { return 1; }",
      "export default (anonyme)",
    ],
    [
      "export async function nouvelleAction() {} (déclaration classique, sans garde)",
      "export async function nouvelleAction() { return 1; }",
      "nouvelleAction",
    ],
    [
      "export const nouvelleAction = async () => exigerSessionAtlas(); (corps expression, jamais considéré protégé)",
      "export const nouvelleAction = async () => exigerSessionAtlas();",
      "nouvelleAction",
    ],
  ])("%s : détectée comme NON protégée", (_libelle, code, nomAttendu) => {
    const nonProtegees = nonProtegeesPourSource(code);
    expect(nonProtegees).toHaveLength(1);
    expect(nonProtegees[0].fonction).toBe(nomAttendu);
  });
});
