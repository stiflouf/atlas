import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-059 — la navigation dossier → Contact actif est une LECTURE portée par les repositories de
// dossier, résolue par l'unique primitive de parcours de chaîne, sans écriture, sans accès base
// depuis les pages, sans route nouvelle.

const SRC = join(__dirname, "..");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const lire = (...segments: string[]) => codeSeul(join(SRC, ...segments));

describe("navigation dossier → Contact actif", () => {
  it("chaque repository de dossier porte getNavigationContact*, résolu par resoudreContactActif dans le workspace du dossier", () => {
    for (const [fichier, fonction] of [
      ["clientRepository.ts", "getNavigationContactDeLAcquereur"],
      ["prospectVendeurRepository.ts", "getNavigationContactDuProspectVendeur"],
    ] as const) {
      const code = lire("lib", fichier);
      const corps = code.match(new RegExp(`export async function ${fonction}[\\s\\S]*?\\n}`))?.[0] ?? "";
      expect(corps.length, fichier).toBeGreaterThan(0);
      expect(corps, fichier).toContain("resoudreContactActif(ligne.contactId, ligne.workspaceId, executeur)");
      expect(corps, fichier).toContain('if (resolution.statut !== "actif")');
      expect(corps, fichier).toContain("throw new Error(");
      expect(corps, fichier).not.toMatch(/\.(insert|update|delete)\(|transaction\(/);
      // Aucune seconde traversée : jamais de boucle sur fusionneDansContactId hors contactRepository.
      expect(code, fichier).not.toMatch(/while\s*\(|\.fusionneDansContactId\s*[!=]==|for\s*\([^)]*fusionne/);
      expect(code.match(/resoudreContactActif\(/g)?.length, fichier).toBe(1);
    }
  });

  it("les pages consomment la navigation depuis le repository, sans accès base ni writer", () => {
    for (const [chemin, fonction] of [
      [join("app", "clients", "[id]", "page.tsx"), "getNavigationContactDeLAcquereur"],
      [join("app", "prospects-vendeurs", "[id]", "page.tsx"), "getNavigationContactDuProspectVendeur"],
    ] as const) {
      const page = lire(chemin);
      expect(page, chemin).toContain(`const { contactId: contactCanonique, contactActifId } = await ${fonction}(`);
      expect(page, chemin).not.toMatch(/@\/db\/|drizzle-orm|resoudreContactActif|fusionneDansContactId|contactRepository|fusionContactRepository/);
      expect(page, chemin).toMatch(/contactActifId=\{contactActifId\}/);
    }
  });

  it("les héros rendent « Voir le contact » vers /contacts/{contactActifId}, seulement s'il existe, et rien d'autre de nouveau", () => {
    for (const chemin of [join("components", "client", "AcquereurHero.tsx"), join("components", "prospectVendeur", "ProspectVendeurHero.tsx")]) {
      const hero = lire(chemin);
      expect(hero, chemin).toContain("{contactActifId && (");
      expect(hero, chemin).toContain("href={`/contacts/${contactActifId}`}");
      expect(hero, chemin).toContain("Voir le contact");
      expect(hero, chemin).not.toMatch(/Voir le contact (canonique|actif)|personne fusionnée|Fiche maître/);
      expect(hero, chemin).not.toMatch(/@\/db\/|Repository"|resoudreContactActif/);
    }
  });

  it("aucune route nouvelle : les pages de dossier restent aux chemins existants", () => {
    expect(() => readFileSync(join(SRC, "app", "clients", "[id]", "contact", "page.tsx"))).toThrow();
    expect(() => readFileSync(join(SRC, "app", "prospects-vendeurs", "[id]", "contact", "page.tsx"))).toThrow();
  });
});
