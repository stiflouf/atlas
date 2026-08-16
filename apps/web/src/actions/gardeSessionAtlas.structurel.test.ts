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

function premiereInstructionAppelleExigerSessionAtlas(fn: ts.FunctionDeclaration): boolean {
  const premiereInstruction = fn.body?.statements[0];
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

  const nonProtegees: FonctionNonProtegee[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    const estExportee = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!estExportee) continue;

    if (!premiereInstructionAppelleExigerSessionAtlas(statement)) {
      nonProtegees.push({ fichier, fonction: statement.name.text });
    }
  }
  return nonProtegees;
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
