import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-055 §H — la détection de similarité est une LECTURE explicable et bornée. Ce que ces gardes
// figent : aucune écriture, aucun rattachement, aucun fournisseur, aucun dossier historique, aucun
// score, aucun flou, nom et prénom absents du déclencheur, workspace obligatoire, limite fixe.

const REPOSITORY = join(__dirname, "similariteContactRepository.ts");
const NORMALISATION = join(__dirname, "similariteContactNormalisation.ts");
const TYPE = join(__dirname, "..", "types", "similariteContact.ts");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const repository = codeSeul(REPOSITORY);
const normalisation = codeSeul(NORMALISATION);
const type = codeSeul(TYPE);
const tout = repository + normalisation;

describe("similariteContactRepository — lecture seule", () => {
  it("le workspace est obligatoire dans la signature, jamais optionnel ni avec repli", () => {
    expect(repository).toMatch(
      /export async function trouverContactsSimilaires\(\s*contactId: string,\s*workspaceId: string,/
    );
    expect(repository).not.toMatch(/workspaceId\?/);
    expect(repository).not.toMatch(/workspaceId\s*=\s*["'`]/);
    expect(repository).not.toMatch(/workspaceId\s*\?\?/);
    // Le filtre de périmètre porte sur la source ET sur les candidats.
    expect(repository.match(/eq\(contactsTable\.workspaceId, workspaceId\)/g)?.length).toBe(2);
  });

  it("n'écrit jamais : ni insert, ni update, ni delete, ni transaction", () => {
    for (const interdit of [".insert(", ".update(", ".delete(", "transaction(", "returning("]) {
      expect(tout, interdit).not.toContain(interdit);
    }
  });

  it("n'importe aucun chemin d'écriture, de rattachement ni de formulaire", () => {
    for (const interdit of [
      "@/actions",
      "rattachementContact",
      "modifierIdentiteContact",
      "creerContact",
      "contactFormulaire",
      "verrouillerChamp",
      "champVerrouilleRepository",
    ]) {
      expect(tout, interdit).not.toContain(interdit);
    }
  });

  it("ne connaît ni fournisseur, ni référence externe, ni dossier historique", () => {
    for (const interdit of [
      "referencesExternes",
      "references_externes",
      "referenceExterneRepository",
      "acquereursTable",
      "prospectsVendeursTable",
      "acquereurs,",
      "prospectsVendeurs,",
      "memoireContextuelle",
    ]) {
      expect(tout, interdit).not.toContain(interdit);
    }
    expect(tout).not.toMatch(/gmail|google|playiad|\biad\b|synchronis|connecteur|fournisseur/i);
  });

  it("aucun flou : ni trigram, ni distance, ni extension, ni ilike", () => {
    expect(tout).not.toMatch(/pg_trgm|unaccent|similarity\(|levenshtein|soundex|metaphone|<->|ilike|like\(/i);
    // Le seul `like` est celui qui reconnaît un `+` de tête dans un numéro.
    expect(normalisation.match(/like '\+%'/g)?.length).toBe(1);
  });

  it("aucun score numérique : ni pourcentage, ni confiance, ni pondération", () => {
    expect(tout + type).not.toMatch(/score|confiance|confidence|pourcentage|percentage|poids|weight|seuil|threshold/i);
    expect(type).toMatch(/signaux: SignalSimilariteContact\[\]/);
    expect(type).toMatch(/"email" \| "telephone" \| "nom_prenom"/);
  });

  it("nom et prénom n'entrent jamais dans le déclencheur : seuls email et téléphone filtrent", () => {
    const declencheur = repository.match(/function conditionCandidats\([\s\S]*?\n}/)?.[0];
    expect(declencheur).toBeDefined();
    expect(declencheur).not.toMatch(/nom|prenom/);
    expect(declencheur).toContain("cleEmailSql(contactsTable.email)");
    expect(declencheur).toContain("cleTelephoneSql(contactsTable.telephone)");
    // La corroboration est calculée en mémoire, jamais en SQL.
    expect(repository.indexOf("cleNomPrenom(")).toBeGreaterThan(repository.lastIndexOf(".where("));
    expect(repository.indexOf("cleNomPrenom(")).toBeGreaterThan(repository.indexOf(".limit(LIMITE_CANDIDATS)"));
    expect(normalisation).not.toMatch(/function cleNomPrenom[\s\S]*?sql`/);
  });

  it("la limite est une constante bornée, appliquée en SQL", () => {
    expect(repository).toContain("export const LIMITE_CANDIDATS = 10;");
    expect(repository).toContain(".limit(LIMITE_CANDIDATS)");
  });

  it("les agrégats sont batchés par l'assembleur de la recherche, jamais par candidat", () => {
    expect(repository).toContain("assemblerResultatsContacts(candidats, executeur)");
    expect(repository).not.toMatch(/for\s*\([^)]*\)\s*{[^}]*await executeur/);
    expect(repository).not.toMatch(/\.map\([^)]*=>\s*executeur/);
    expect(repository).not.toMatch(/Promise\.all\([^)]*executeur/);
  });

  it("aucune suggestion persistée : aucune table de similarité n'existe dans le schéma", () => {
    // Le MARQUEUR de fusion (ADR-059, `contacts.fusionne_dans_contact_id`) n'est pas une suggestion :
    // c'est une décision humaine déjà prise. Ce qui reste interdit, c'est toute table de candidats.
    const schema = codeSeul(join(__dirname, "..", "db", "schema.ts"));
    expect(schema).not.toMatch(/similarit|duplicate|dedup|doublon/i);
  });

  it("ADR-059 — un contact absorbé n'est ni source ni candidat", () => {
    expect(repository.match(/isNull\(contactsTable\.fusionneDansContactId\)/g)?.length).toBe(2);
  });

  it("la normalisation email ne porte aucune règle de fournisseur", () => {
    const email = normalisation.match(/function cleEmailSql[\s\S]*?\n}/)?.[0] ?? "";
    expect(email).toContain("lower(btrim(");
    expect(email).not.toMatch(/replace|split|@|\+/);
  });
});
