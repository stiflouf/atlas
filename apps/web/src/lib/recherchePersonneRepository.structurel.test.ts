import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResultatLegacyAcquereur, ResultatLegacyVendeur } from "@/types/recherchePersonne";

// ADR-058 décision 5 + ADR-055 §H — la recherche mixte est la surface où la fusion silencieuse
// reviendrait le plus naturellement : « juste » regrouper deux lignes au même email, « juste »
// rattacher quand il n'y a qu'un seul candidat. Ces tests verrouillent la frontière dans le code.

const RECHERCHE = join(__dirname, "recherchePersonneRepository.ts");

// Le CODE seul : les commentaires expliquent l'interdiction et contiennent les mots surveillés.
function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const code = codeSeul(RECHERCHE);

describe("recherchePersonneRepository — lecture seule", () => {
  it("n'importe aucun chemin d'écriture ni de rattachement", () => {
    for (const interdit of [
      "contactRepository",
      "partieProjetRepository",
      "rattachementContact",
      "@/actions/",
      "creerContact",
      "rattacherAcquereurAuContact",
      "rattacherProspectVendeurAuContact",
    ]) {
      expect(code, interdit).not.toContain(interdit);
    }
  });

  it("n'écrit jamais : ni insert, ni update, ni delete, ni transaction", () => {
    expect(code).not.toMatch(/\.(insert|update|delete)\(/);
    expect(code).not.toMatch(/transaction\(/);
  });
});

describe("recherchePersonneRepository — jamais de fusion", () => {
  it("aucune déduplication par email, téléphone ou nom", () => {
    expect(code).not.toMatch(/groupBy\(/i);
    expect(code).not.toMatch(/distinct/i);
    expect(code).not.toMatch(/new Set\(/);
    expect(code).not.toMatch(/new Map\([^)]*(email|telephone|nom)/i);
    // UNION ALL conserve chaque ligne ; UNION dédoublonnerait des lignes identiques.
    expect(code).toContain("unionAll(");
    expect(code).not.toMatch(/\bunion\(/);
  });

  it("aucun contact virtuel : un id de dossier ne devient jamais un contactId", () => {
    expect(code).not.toMatch(/contactId:\s*ligne\.id/);
    expect(code).toContain('acquereurId: ligne.id');
    expect(code).toContain('prospectVendeurId: ligne.id');
  });

  it("le type legacy ne peut pas porter de contactId", () => {
    type SansContactId<T> = "contactId" extends keyof T ? never : true;
    const acquereur: SansContactId<ResultatLegacyAcquereur> = true;
    const vendeur: SansContactId<ResultatLegacyVendeur> = true;
    expect(acquereur && vendeur).toBe(true);
  });
});

describe("recherchePersonneRepository — périmètre des sources", () => {
  it("les dossiers déjà rattachés sont exclus des deux sources historiques", () => {
    expect(code).toContain("isNull(acquereursTable.contactId)");
    expect(code).toContain("isNull(prospectsVendeursTable.contactId)");
  });

  it("le workspace est obligatoire et filtré sur les trois sources", () => {
    expect(code).toMatch(/workspaceId: string;/);
    expect(code).not.toMatch(/workspaceId\?:/);
    for (const table of ["contactsTable", "acquereursTable", "prospectsVendeursTable"]) {
      expect(code).toContain(`eq(${table}.workspaceId, params.workspaceId)`);
    }
  });

  it("le ranking et le filtre viennent du read model canonique, jamais réécrits", () => {
    expect(code).toMatch(/import \{[^}]*expressionRang[^}]*\} from "@\/lib\/rechercheContactRepository"/);
    expect(code).toMatch(/import \{[^}]*filtreTexte[^}]*\} from "@\/lib\/rechercheContactRepository"/);
    expect(code).not.toMatch(/ilike\(/);
    expect(code).not.toMatch(/case\s+when/i);
  });

  it("aucun terme de recherche n'est journalisé", () => {
    expect(code).not.toMatch(/console\.\w+/);
  });
});
