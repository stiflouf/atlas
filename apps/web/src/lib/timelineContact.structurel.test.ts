import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// CRM_TIMELINE_V1 — gardes structurelles : l'historique reste un read model (aucune table, aucune
// migration), l'échange manuel écrit UNE interaction canonique (aucune double écriture vers le
// journal legacy), sous protection contact actif + workspace ; le repository ne connaît pas l'UI ;
// la mémoire acquéreur et le writer du journal prospect vendeur restent hors du chantier.
const SRC = join(__dirname, "..");
const lire = (chemin: string) => readFileSync(join(SRC, chemin), "utf8");
const codeSeul = (chemin: string) => lire(chemin).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("CRM_TIMELINE_V1 — read model, jamais une table", () => {
  it("aucune table timeline dans le schéma, aucune migration ajoutée (54 fichiers SQL, dernière = 0053)", () => {
    const schema = lire("db/schema.ts");
    expect(schema).not.toMatch(/pgTable\(\s*"(timeline|historique_contact|historique_echange)/i);
    expect(schema).not.toMatch(/timeline_contact|historique_contact|timelineContact/);
    const migrations = readdirSync(join(SRC, "db", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(migrations).toHaveLength(54);
    expect(migrations[migrations.length - 1]).toBe("0053_seller_feedback_interaction_v1.sql");
  });

  it("le read model lit les deux sources bornées, trie en mémoire, et n'écrit jamais", () => {
    const repo = codeSeul("lib/timelineContactRepository.ts");
    expect(repo).toContain(".from(interactionsTable)");
    expect(repo).toContain(".from(notesProspectVendeurTable)");
    expect(repo.match(/\.limit\(limite\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(repo).toContain("items.sort(comparerItems).slice(0, borne)");
    expect(repo).not.toMatch(/\.insert\(|\.update\(|\.delete\(|transaction\(/);
    // Objet Gmail : références externes → envois_email, jamais un client Gmail.
    expect(repo).toContain("eq(envoisEmailTable.gmailMessageId, referencesExternesTable.idExterne)");
    expect(repo).not.toMatch(/googleapis|gmailClient|lib\/gmail/);
    // Le rapprochement exige l'objet ET le format legacy exact — la fenêtre de temps n'est qu'une garde.
    expect(repo).toContain('const PREFIXE_NOTE_LEGACY_GMAIL = "Email envoyé — Objet : "');
    expect(repo).toContain("i.gmail!.sujetNormalise === sujet &&");
    expect(repo).toContain("if (note.legacyGmailSujet === undefined) return true;");
  });

  it("le repository timeline n'importe aucune UI et le composant n'importe aucun repository", () => {
    expect(lire("lib/timelineContactRepository.ts")).not.toMatch(/from "react|from "next\/|@\/components\//);
    expect(lire("types/timelineContact.ts")).not.toMatch(/from "react|@\/db\/|Repository/);
    expect(lire("components/contact/TimelineContact.tsx")).not.toMatch(/Repository|@\/db\/|@\/actions\//);
    // Le composant n'ordonne ni ne filtre : il rend la liste telle que livrée.
    expect(codeSeul("components/contact/TimelineContact.tsx")).not.toMatch(/items\.(sort|filter|reverse)\(/);
  });
});

describe("CRM_TIMELINE_V1 — writer : une interaction canonique, jamais de double écriture", () => {
  const writer = codeSeul("lib/interactionRepository.ts");
  const corps = writer.slice(writer.indexOf("export async function enregistrerEchangeManuel("));

  it("NO_DUAL_WRITE : ni l'action ni le writer ne touchent notes_prospect_vendeur", () => {
    for (const chemin of ["actions/enregistrerEchange.ts", "lib/interactionRepository.ts", "components/contact/NoterEchangeForm.tsx"]) {
      expect(codeSeul(chemin), chemin).not.toMatch(/notesProspectVendeur|ajouterNoteProspectVendeur|noteProspectVendeurRepository/);
    }
  });

  it("transaction, contact actif SOUS VERROU avec le workspace explicite, contexte validé, réutilise creerInteraction", () => {
    expect(corps).toContain("return executeur.transaction(async (tx) => {");
    expect(corps).toContain("await verrouillerContactActif(input.contactId, tx, workspaceId)");
    expect(corps).toContain('return { statut: "contact_fusionne" }');
    expect(corps).toContain("await contexteAppartientAuContact(input.contactId, workspaceId, input.contexte, tx)");
    expect(corps).toContain("await creerInteraction(");
    expect(corps).not.toMatch(/resoudreContactActif|fusionneDansContactId/);
  });

  it("dernier_contact_le : monotone (greatest), prospects ACTIFS du contact et du workspace, jamais pour une note", () => {
    expect(corps).toContain("if (TYPES_ECHANGE_CONTACT_HUMAIN.includes(input.type))");
    expect(writer).toContain('export const TYPES_ECHANGE_CONTACT_HUMAIN: readonly TypeInteraction[] = ["appel", "email", "sms", "rendez_vous", "message"]');
    expect(corps).toContain("greatest(coalesce(");
    expect(corps).toContain("eq(prospectsVendeursTable.workspaceId, workspaceId)");
    expect(corps).toContain("isNull(prospectsVendeursTable.archiveLe)");
    expect(corps).toContain("isNull(prospectsVendeursTable.datePerte)");
  });

  it("l'action suit FORM_FEEDBACK_V1 et redirige vers la fiche Contact", () => {
    const action = lire("actions/enregistrerEchange.ts");
    expect(action).toContain(
      "export async function enregistrerEchangeAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {\n  await exigerSessionAtlas();\n  return avecFeedbackFormulaire(async () => {"
    );
    expect(action).toContain("await exigerWorkspaceCourant()");
    expect(action).toContain("enregistrerEchangeManuel(");
    expect(action).toContain("redirect(`/contacts/${contactId}`)");
    expect(action).not.toContain("throw new Error(");
  });
});

describe("CRM_TIMELINE_V1 — hors périmètre, intacts", () => {
  it("memoireAcquereur ignore la timeline ; le journal prospect vendeur et son writer restent sur notes_prospect_vendeur", () => {
    expect(lire("lib/relations/memoireAcquereur.ts")).not.toMatch(/timelineContact|ItemTimelineContact/);
    const journal = lire("components/prospectVendeur/ProspectVendeurJournal.tsx");
    expect(journal).toContain('import { ajouterNoteProspectVendeurAction } from "@/actions/prospectVendeur"');
    expect(journal).not.toMatch(/enregistrerEchange|timelineContact/);
    const writerLegacy = codeSeul("lib/noteProspectVendeurRepository.ts");
    expect(writerLegacy).toContain(".insert(notesProspectVendeurTable)");
    expect(writerLegacy).not.toMatch(/interactionsTable|creerInteraction|enregistrerEchangeManuel/);
  });
});
