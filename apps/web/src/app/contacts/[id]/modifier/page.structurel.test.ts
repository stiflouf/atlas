import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-057 — UN SEUL writer d'identité Contact dans tout le produit, et cet écran ne fait que
// l'appeler. Ce qui est verrouillé ici : pas de second UPDATE `contacts`, pas d'écriture sur les
// dossiers historiques, pas de rattachement, pas de création ni de rapprochement de contact, pas
// de fournisseur.

const PAGE = join(__dirname, "page.tsx");
const ACTION = join(__dirname, "..", "..", "..", "..", "actions", "modifierContact.ts");
const FORMULAIRE = join(__dirname, "..", "..", "..", "..", "lib", "contactFormulaire.ts");
const RACINE = join(__dirname, "..", "..", "..", "..");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

function listerFichiersSource(racine: string): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((entree) => {
    const chemin = join(racine, entree.name);
    if (entree.isDirectory()) return listerFichiersSource(chemin);
    return /\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) ? [chemin] : [];
  });
}

const page = codeSeul(PAGE);
const action = codeSeul(ACTION);
const formulaire = codeSeul(FORMULAIRE);

describe("/contacts/[id]/modifier — un seul writer Contact", () => {
  it("un seul UPDATE de contacts dans tout src, et c'est contactRepository", () => {
    const porteurs = listerFichiersSource(RACINE).filter((chemin) => /update\(\s*contactsTable/.test(codeSeul(chemin)));
    expect(porteurs).toEqual([join(RACINE, "lib", "contactRepository.ts")]);
  });

  it("la Server Action passe par modifierIdentiteContact, jamais par Drizzle", () => {
    expect(action).toContain("modifierIdentiteContact(");
    expect(action).not.toMatch(/contactsTable|@\/db\/schema|drizzle-orm/);
    expect(action).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it("la page n'importe ni base, ni schéma, ni dossier historique", () => {
    expect(page).not.toMatch(/@\/db\/|drizzle-orm|clientRepository|prospectVendeurRepository|acquereur|prospect/i);
    expect(page).toContain("getContactDuWorkspace(id, workspaceId)");
    expect(page).toContain("notFound()");
    expect(page).toContain("action={modifierContactAction}");
  });

  it("aucune écriture sur les dossiers historiques, aucun rattachement, aucune création de contact", () => {
    for (const source of [page, action, formulaire]) {
      expect(source).not.toMatch(/modifierAcquereur|modifierProspectVendeur|acquereursTable|prospectsVendeursTable/);
      expect(source).not.toMatch(/rattachementContact|rattacher|creerContact|contactId:/);
    }
  });

  it("aucune déduplication, aucun fournisseur, aucune journalisation", () => {
    for (const source of [page, action, formulaire]) {
      expect(source).not.toMatch(/findOrCreate|trouverOuCreer|rapprocher|fusionner|dedup|ilike\(/);
      expect(source).not.toMatch(/referencesExternes|lib\/provenance|google|gmail|synchronisation/i);
      expect(source).not.toMatch(/console\.\w+/);
    }
  });

  it("la frontière transforme « » en absence, et ne normalise rien d'autre", () => {
    expect(formulaire).toContain('texte !== "" ? texte : undefined');
    expect(formulaire).not.toMatch(/toLowerCase|replace\(/);
  });

  it("le workspace vient de la session dans l'action et dans la page, jamais du formulaire", () => {
    expect(action).toContain("exigerSessionAtlas()");
    expect(action).toContain("exigerWorkspaceCourant()");
    expect(action).not.toMatch(/formData\.get\("workspace/);
    expect(page).toContain("exigerWorkspaceCourant()");
  });
});
