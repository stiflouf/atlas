import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-057 — la recherche `q` des listes de dossiers lit la MÊME source que l'affichage : un
// prédicat SQL sur l'identité effective, écrit dans le module qui porte la règle, sans repli champ
// par champ, sans filtrage en mémoire, sans résolution de chaîne par ligne, sans écriture.

const SRC = join(__dirname, "..");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const REGLE = codeSeul(join(SRC, "lib", "identiteContactEffective.ts"));

const RECHERCHES = [
  ["clientRepository.ts", "rechercherAcquereursPage", "acquereursTable"],
  ["prospectVendeurRepository.ts", "rechercherProspectsVendeurs", "prospectsVendeursTable"],
] as const;

function corps(fichier: string, fonction: string): string {
  const code = codeSeul(join(SRC, "lib", fichier));
  const debut = code.indexOf(`export async function ${fonction}(`);
  expect(debut, `${fichier} : ${fonction}`).toBeGreaterThanOrEqual(0);
  const suite = code.indexOf("\nexport ", debut + 1);
  return code.slice(debut, suite === -1 ? undefined : suite);
}

describe("recherche sur l'identité effective — structure", () => {
  it("la règle SQL est un CASE sur contact_id, jamais un COALESCE champ par champ", () => {
    expect(REGLE).toMatch(/case when \$\{colonneContactId\} is not null then \$\{contact\} else \$\{legacy\} end/);
    expect(REGLE).not.toMatch(/coalesce/i);
    expect(REGLE).toMatch(/export function identiteEffectiveSql\(/);
    expect(REGLE).toMatch(/export function joindreContactCanonique</);
    expect(REGLE).toMatch(/export function filtreIdentiteEffective\(/);
    // Le prédicat porte sur les quatre champs effectifs.
    for (const champ of ["nom", "prenom", "email", "telephone"]) {
      expect(REGLE).toContain(`ilike(identite.${champ}, motif)`);
    }
  });

  it("les deux recherches consomment la règle : jointure et filtre effectifs, aucun ILIKE sur l'instantané", () => {
    for (const [fichier, fonction, table] of RECHERCHES) {
      const code = corps(fichier, fonction);
      expect(code, fonction).toContain(`filtreIdentiteEffective(texte, identiteEffectiveSql(${table}.contactId, ${table}))`);
      expect(code, fonction).toContain(`joindreContactCanonique(`);
      expect(code, fonction).toContain(`getTableColumns(${table})`);
      expect(code, fonction).not.toMatch(new RegExp(`ilike\\(${table}\\.(nom|prenom|email|telephone)`));
      expect(code, fonction).not.toMatch(/ilike\(\s*contactsTable/);
    }
  });

  it("aucun filtrage texte en mémoire, aucune résolution de chaîne par ligne, aucune écriture", () => {
    for (const [fichier, fonction] of RECHERCHES) {
      const code = corps(fichier, fonction);
      expect(code, fonction).not.toMatch(/\.filter\([^)]*(texte|\.nom|\.prenom|\.email|\.telephone)/);
      expect(code, fonction).not.toMatch(/toLowerCase|includes\(texte|new RegExp/);
      expect(code, fonction).not.toContain("resoudreContactActif");
      expect(code, fonction).not.toMatch(/fusionneDansContactId|\.map\([^)]*await/);
      expect(code, fonction).not.toMatch(/\.(insert|update|delete)\(|transaction\(/);
    }
  });

  it("la jointure dossier → contact reste écrite dans le seul module de la règle", () => {
    for (const fichier of ["clientRepository.ts", "prospectVendeurRepository.ts"]) {
      expect(codeSeul(join(SRC, "lib", fichier)), fichier).not.toMatch(/leftJoin\(|innerJoin\(/);
    }
  });
});
