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
  it("appelle ses deux read models, et n'importe ni schéma, ni client de base, ni autre repository", () => {
    expect(page).toMatch(/import \{ chargerContactDetail \} from "@\/lib\/contactDetailRepository"/);
    expect(page).toContain("chargerContactDetail(id, workspaceId)");
    // ADR-055 §H — les Contacts similaires viennent du read model dédié, avec le MÊME workspace.
    expect(page).toMatch(/import \{ trouverContactsSimilaires \} from "@\/lib\/similariteContactRepository"/);
    expect(page).toContain("trouverContactsSimilaires(id, workspaceId)");
    expect(page.match(/Repository"/g)).toHaveLength(2);
    expect(page).not.toMatch(/@\/db\/|drizzle-orm|Table\b/);
  });

  it("la section similaires reçoit les candidats tels quels : ni tri, ni borne, ni filtre dans la page", () => {
    expect(page).toContain("<ContactsSimilairesSection contactCourantId={contact.id} candidats={contactsSimilaires ?? []} />");
    expect(page).not.toMatch(/contactsSimilaires\.(slice|sort|filter|map)\(/);
    // Le 404 reste décidé par la fiche seule.
    expect(page).not.toMatch(/contactsSimilaires\s*===\s*undefined|!contactsSimilaires\)/);
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

// ADR-059 — « Contacts fusionnés » : lu dans le JOURNAL par le read model, rendu par la page sans
// lecture technique, uniquement sur une fiche active.
describe("/contacts/[id] — contacts fusionnés (ADR-059)", () => {
  const FICHE_ABSORBEE = codeSeul(join(__dirname, "..", "..", "..", "components", "contact", "ContactFusionneFiche.tsx"));

  it("le read model lit le journal contact_fusions, scoped par le survivant du workspace, ordonné, sans joindre l'absorbé", () => {
    const debut = readModel.indexOf("export async function listerFusionsAbsorbees(");
    expect(debut).toBeGreaterThanOrEqual(0);
    const corps = readModel.slice(debut, readModel.indexOf("\nexport ", debut + 1));
    expect(corps).toContain(".from(contactFusionsTable)");
    expect(corps).toContain("eq(contactsTable.id, contactFusionsTable.contactSurvivantId), eq(contactsTable.workspaceId, workspaceId)");
    expect(corps).toContain("eq(contactFusionsTable.contactSurvivantId, contactSurvivantId)");
    expect(corps).toContain("desc(contactFusionsTable.fusionneLe), desc(contactFusionsTable.id)");
    expect(corps).toContain("identiteAbsorbee: ligne.identiteAvantAbsorbe");
    // Identité du journal, jamais de la ligne `contacts` de l'absorbé ; aucun champ technique exposé.
    expect(corps).not.toMatch(/contactFusionsTable\.contactAbsorbeId\s*,\s*contactsTable\.id|contactsTable\.(nom|prenom|email|telephone)/);
    expect(corps).not.toMatch(/fusionneParSub|idsDeplaces|choixParChamp|avertissementsAcquittes|identiteFinale|identiteAvantSurvivant/);
    expect(corps).not.toMatch(/\.limit\(|resoudreContactActif|fusionneDansContactId/);
    // Jamais reconstitué depuis le marqueur de `contacts`.
    expect(readModel).not.toMatch(/eq\(contactsTable\.fusionneDansContactId/);
  });

  it("la fiche active charge les fusions dans le Promise.all des lectures indépendantes ; la fiche absorbée ne les charge pas", () => {
    expect(readModel).toContain("listerFusionsAbsorbees(contactId, workspaceId, executeur),");
    expect(readModel.indexOf('type: "fusionne"')).toBeLessThan(readModel.indexOf("listerFusionsAbsorbees(contactId"));
    expect(readModel).toContain("fusionsAbsorbees,");
  });

  it("la page rend la section depuis le read model, conditionnellement, avec le vocabulaire produit et sans donnée technique", () => {
    expect(page).toContain("{fusionsAbsorbees.length > 0 && (");
    expect(page).toContain("<SectionTitle>Contacts fusionnés</SectionTitle>");
    expect(page).toContain("Ces anciennes fiches ont été regroupées avec ce contact.");
    expect(page).toContain("Voir le contact fusionné");
    expect(page).toContain("href={`/contacts/${fusion.contactAbsorbeId}`}");
    expect(page).toContain("nomComplet(fusion.identiteAbsorbee)");
    expect(page).toContain("{fusion.fusionneParEmail && <> par {fusion.fusionneParEmail}</>}");
    expect(page).not.toMatch(/identiteAbsorbee\.(email|telephone)|fusionneParSub|idsDeplaces|choixParChamp|avertissements|identiteFinale|JSON\.stringify/);
    expect(page).not.toMatch(/Aucun contact fusionné|listerFusionsAbsorbees|contactFusions/);
    // Placement : après la similarité, avant les projets acquéreur.
    expect(page.indexOf("<ContactsSimilairesSection")).toBeLessThan(page.indexOf("Contacts fusionnés"));
    expect(page.indexOf("Contacts fusionnés")).toBeLessThan(page.indexOf("Projets acquéreur"));
  });

  it("la fiche absorbée reste inchangée : aucun historique descendant", () => {
    expect(FICHE_ABSORBEE).not.toMatch(/fusionsAbsorbees|Contacts fusionnés|contactFusions/);
  });

  it("aucune route nouvelle", () => {
    expect(() => readFileSync(join(__dirname, "fusions", "page.tsx"))).toThrow();
    expect(() => readFileSync(join(__dirname, "historique", "page.tsx"))).toThrow();
  });
});

describe("contactDetailRepository — lecture seule, par clés réelles", () => {
  it("n'écrit jamais et n'importe aucun chemin d'écriture", () => {
    expect(readModel).not.toMatch(/\.(insert|update|delete)\(/);
    expect(readModel).not.toMatch(/transaction\(/);
    for (const interdit of ["rattachementContact", "partieProjetRepository", "@/actions/"]) {
      expect(readModel, interdit).not.toContain(interdit);
    }
    // ADR-059 — de contactRepository, UNE lecture : la résolution de chaîne. Aucun writer.
    expect(readModel).toMatch(/import \{ resoudreContactActif \} from "@\/lib\/contactRepository"/);
    expect(readModel).not.toMatch(/modifierIdentiteContact|creerContact|getContactDuWorkspace|getContactById/);
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
