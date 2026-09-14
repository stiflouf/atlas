import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-058 — la page `/contacts` CONSOMME le read model, elle ne le réécrit pas. Ce que ces tests
// protègent est une frontière : le jour où « juste pour afficher la ville » la page lit elle-même
// une table, ou regroupe « juste visuellement » deux cartes au même email, c'est la fusion
// silencieuse qu'ADR-055 §H interdit qui revient par l'écran.

const PAGE = join(__dirname, "page.tsx");
const CARTE = join(__dirname, "..", "..", "components", "contact", "ContactResultatCard.tsx");

// Le CODE seul : les commentaires expliquent l'interdiction et contiennent donc les mots surveillés.
function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const page = codeSeul(PAGE);
const carte = codeSeul(CARTE);

describe("/contacts — la page consomme le read model", () => {
  it("appelle rechercherContacts, et rien d'autre côté données", () => {
    expect(page).toMatch(/import \{ rechercherContacts \} from "@\/lib\/rechercheContactRepository"/);
    expect(page).toContain("rechercherContacts({");
    expect(page.match(/Repository"/g)).toHaveLength(1);
  });

  it("n'importe ni schéma, ni client de base, ni drizzle", () => {
    for (const source of [page, carte]) {
      expect(source).not.toMatch(/@\/db\//);
      expect(source).not.toMatch(/drizzle-orm/);
      expect(source).not.toMatch(/contactsTable|partiesProjetTable|interactionsTable|acquereursTable|prospectsVendeursTable/);
    }
  });

  it("le workspace vient de la session, jamais d'un paramètre d'URL", () => {
    expect(page).toContain("exigerWorkspaceCourant()");
    expect(page).not.toMatch(/\{[^}]*workspace[^}]*\}\s*=\s*await searchParams/i);
    expect(page).not.toMatch(/searchParams\.workspace/i);
  });

  it("aucune dérivation métier : rôle, statut vendeur et ranking restent dans le read model", () => {
    for (const source of [page, carte]) {
      expect(source).not.toMatch(/deriverStatutProspectVendeur|\.sort\(|localeCompare/);
      expect(source).not.toMatch(/roles\s*=|roles\.push|roles\.add/);
    }
  });

  it("aucune fusion ni regroupement par email ou téléphone dans les composants", () => {
    for (const source of [page, carte]) {
      expect(source).not.toMatch(/new Map\(|new Set\(|groupBy|\.reduce\(/);
      expect(source).not.toMatch(/\.email\s*===|\.telephone\s*===/);
    }
  });

  it("aucun lien inventé vers une fiche Contact qui n'existe pas encore", () => {
    for (const source of [page, carte]) {
      expect(source).not.toMatch(/\/contacts\/\$\{|`\/contacts\/|\/clients\/\$\{|\/prospects-vendeurs\/\$\{/);
    }
  });

  it("aucun terme de recherche n'est journalisé", () => {
    expect(page).not.toMatch(/console\.|analytics|logger/);
  });
});
