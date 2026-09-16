import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-055 §H — « Créer un contact depuis ce dossier » est UNE primitive atomique : dossier relu et
// verrouillé dans le workspace, contact créé à son image, rattachement, ou rollback. Les Server
// Actions n'assemblent jamais création + rattachement elles-mêmes, et aucun refus n'est retourné
// après une écriture sans annuler la transaction.

const SRC = join(__dirname, "..");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const MODULE = codeSeul(join(SRC, "lib", "rattachementContact.ts"));
const ACTION = codeSeul(join(SRC, "actions", "rattacherContact.ts"));

function corps(code: string, signature: string): string {
  const debut = code.indexOf(signature);
  expect(debut, signature).toBeGreaterThanOrEqual(0);
  const suite = code.indexOf("\nexport ", debut + 1);
  return code.slice(debut, suite === -1 ? undefined : suite);
}

describe("création + rattachement — primitive atomique", () => {
  const primitive = corps(MODULE, "async function creerEtRattacher(");

  it("ouvre sa propre transaction et relit le dossier FOR UPDATE, dans le workspace, avant toute écriture", () => {
    expect(primitive).toContain("executeur.transaction(async (tx) =>");
    expect(primitive).toContain(".for(\"update\")");
    expect(primitive).toContain("eq(dossier.id, dossierId), eq(dossier.workspaceId, workspaceId)");
    const verrou = primitive.indexOf(".for(\"update\")");
    const creation = primitive.indexOf("creerContact(");
    expect(verrou).toBeGreaterThan(0);
    expect(creation).toBeGreaterThan(verrou);
    expect(primitive.indexOf("ligne.contactId !== null")).toBeLessThan(creation);
  });

  it("l'identité vient de la ligne relue sous verrou, jamais d'un paramètre", () => {
    expect(primitive).toContain("nom: ligne.nom");
    expect(primitive).not.toMatch(/identite:\s*\{[^}]*nom:\s*string/);
    expect(MODULE).not.toMatch(/export async function creerContactEtRattacher\w+\([^)]*identite/);
  });

  it("un refus après l'INSERT est LEVÉ (rollback), jamais retourné ; la traduction se fait hors transaction", () => {
    const dansTx = primitive.slice(primitive.indexOf("executeur.transaction("), primitive.indexOf("} catch (erreur)"));
    expect(dansTx).toContain("throw new RefusRattachement(");
    expect(dansTx).not.toMatch(/return \{ statut: "(deja_rattache|dossier_introuvable)"/);
    expect(dansTx).not.toMatch(/return resultat;/);
    expect(primitive).toContain("if (erreur instanceof RefusRattachement) return erreur.refus;");
    expect(primitive).toContain("throw erreur;");
  });

  it("un seul writer Contact : creerContact de contactRepository, aucun insert direct", () => {
    expect(MODULE).not.toMatch(/\.insert\(\s*contactsTable/);
    expect(MODULE).toMatch(/import \{ creerContact \} from "@\/lib\/contactRepository"/);
    expect(MODULE.match(/creerContact\(/g)).toHaveLength(1);
  });

  it("le résultat public ne distingue pas un autre workspace d'un dossier introuvable", () => {
    const type = MODULE.slice(MODULE.indexOf("export type ResultatCreationEtRattachement"), MODULE.indexOf("type RefusCreationEtRattachement"));
    expect(type).not.toContain("workspaces_differents");
    expect(type).not.toContain("contact_introuvable");
    expect(type).toContain('{ statut: "dossier_introuvable" }');
  });

  it("le commentaire d'invariant est enfin vrai, et toujours là", () => {
    const source = readFileSync(join(SRC, "lib", "rattachementContact.ts"), "utf8");
    expect(source).toContain("aucun contact orphelin ne subsiste");
  });
});

describe("Server Actions de rattachement — orchestration seulement", () => {
  it("« créer depuis le dossier » appelle la primitive atomique, sans lecture legacy ni transaction propre", () => {
    for (const [action, primitive] of [
      ["creerContactDepuisAcquereurAction", "creerContactEtRattacherAcquereur(acquereurId, workspaceId)"],
      ["creerContactDepuisProspectVendeurAction", "creerContactEtRattacherProspectVendeur(prospectId, workspaceId)"],
    ] as const) {
      const code = corps(ACTION, `export async function ${action}(`);
      expect(code, action).toContain(primitive);
      expect(code, action).not.toMatch(/getClientById|getProspectVendeurById|transaction\(|creerContact\(|rattacher\w+AuContact\(/);
      expect(code, action).toContain("exigerWorkspaceCourant()");
    }
    expect(ACTION).not.toMatch(/@\/lib\/clientRepository|@\/lib\/prospectVendeurRepository/);
  });

  it("aucune écriture directe, aucun workspace lu du formulaire", () => {
    expect(ACTION).not.toMatch(/\.(insert|update|delete)\(|@\/db\/schema|drizzle-orm/);
    expect(ACTION).not.toMatch(/formData\.get\(\s*["']workspace/);
    expect(ACTION).toContain("exigerSessionAtlas()");
  });

  it("« rattacher à un contact existant » garde la primitive existante, dans une transaction", () => {
    expect(ACTION).toContain("rattacherAcquereurAuContact(acquereurId, contactId, workspaceId, tx)");
    expect(ACTION).toContain("rattacherProspectVendeurAuContact(prospectId, contactId, workspaceId, tx)");
  });
});
