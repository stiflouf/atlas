import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ADR-058 — la fiche Contact CONSOMME son read model. Frontières verrouillées : aucune table lue
// par la page, aucune écriture, aucune ressemblance email/téléphone, aucun fournisseur, et surtout
// aucun lien de dossier fabriqué depuis un id de projet.

const PAGE = join(__dirname, "page.tsx");
const READ_MODEL = join(__dirname, "..", "..", "..", "lib", "contactDetailRepository.ts");

function codeSeul(chemin: string): string {
  return readFileSync(chemin, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const page = codeSeul(PAGE);
const readModel = codeSeul(READ_MODEL);

describe("/contacts/[id] — la page consomme le read model", () => {
  it("appelle chargerContactDetail, et n'importe ni schéma, ni client de base, ni autre repository", () => {
    expect(page).toMatch(/import \{ chargerContactDetail \} from "@\/lib\/contactDetailRepository"/);
    expect(page).toContain("chargerContactDetail(id, workspaceId)");
    expect(page.match(/Repository"/g)).toHaveLength(1);
    expect(page).not.toMatch(/@\/db\/|drizzle-orm|Table\b/);
  });

  it("le workspace vient de la session et le contact hors périmètre est un 404", () => {
    expect(page).toContain("exigerWorkspaceCourant()");
    expect(page).toContain("notFound()");
    expect(page).not.toMatch(/searchParams/);
  });

  it("aucune action d'écriture Contact : ni import d'action, ni formulaire", () => {
    expect(page).not.toMatch(/@\/actions\//);
    expect(page).not.toMatch(/<form|action=/);
    expect(page).not.toMatch(/modifierIdentiteContact|creerContact|fusionner|supprimer/);
  });

  it("aucun lien de dossier construit depuis un id de projet", () => {
    expect(page).not.toMatch(/\/clients\/\$\{[^}]*projetId/);
    expect(page).not.toMatch(/\/prospects-vendeurs\/\$\{[^}]*projetId/);
    expect(page).toContain("/clients/${projet.acquereurId}");
    expect(page).toContain("/prospects-vendeurs/${projet.prospectVendeurId}");
  });

  it("aucune dérivation métier ni heuristique d'identité dans la page", () => {
    expect(page).not.toMatch(/deriverStatutProspectVendeur|\.sort\(|new Map\(|new Set\(|groupBy|\.reduce\(/);
    expect(page).not.toMatch(/\.email\s*===|\.telephone\s*===|\.nom\s*===/);
  });

  it("aucun fournisseur, aucune journalisation", () => {
    for (const source of [page, readModel]) {
      expect(source).not.toMatch(/referencesExternes|lib\/provenance|google|gmail|iad|synchronisation/i);
      expect(source).not.toMatch(/console\.\w+/);
    }
  });
});

describe("contactDetailRepository — lecture seule, par clés réelles", () => {
  it("n'écrit jamais et n'importe aucun chemin d'écriture", () => {
    expect(readModel).not.toMatch(/\.(insert|update|delete)\(/);
    expect(readModel).not.toMatch(/transaction\(/);
    for (const interdit of ["contactRepository", "rattachementContact", "partieProjetRepository", "@/actions/"]) {
      expect(readModel, interdit).not.toContain(interdit);
    }
  });

  it("aucun rapprochement par email, téléphone ou nom : uniquement contact_id et projet_*_id", () => {
    expect(readModel).not.toMatch(/ilike\(|Table\.(email|telephone|nom)\b/);
    expect(readModel).toContain("eq(acquereursTable.contactId, contactId)");
    expect(readModel).toContain("eq(prospectsVendeursTable.contactId, contactId)");
    expect(readModel).toContain("eq(interactionsTable.contactId, contactId)");
    expect(readModel).toContain("eq(partiesProjetTable.contactId, contactId)");
  });

  it("le workspace est obligatoire et le contact est lu dans son périmètre", () => {
    expect(readModel).toContain("eq(contactsTable.workspaceId, workspaceId)");
    expect(readModel).not.toMatch(/workspaceId\?:|workspaceId\s*=\s*["'`]/);
  });

  it("le statut vendeur vient de la primitive métier, et les interactions sont bornées", () => {
    expect(readModel).toContain("deriverStatutProspectVendeur");
    expect(readModel).toContain(".limit(LIMITE_INTERACTIONS_RECENTES)");
  });
});
