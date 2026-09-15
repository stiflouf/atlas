import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-059 — le MODÈLE de fusion, garanti par la base : un contact est fusionné tout entier ou pas
// du tout, jamais vers lui-même, jamais vers un contact inexistant ; le journal exige deux
// contacts réels et distincts. Aucun moteur n'écrit ces états : ils sont posés directement ici,
// comme un futur moteur le ferait dans sa transaction.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { contacts: contactsTable, contactFusions: contactFusionsTable } = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");

const M = `Zfusion${Date.now()}`;
const idsContacts: string[] = [];
const idsFusions: string[] = [];
const INCONNU = "00000000-0000-4000-8000-000000000000";

afterAll(async () => {
  if (idsFusions.length > 0) await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.id, idsFusions));
  if (idsContacts.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
});

async function unContact(nom: string) {
  const contact = await creerContact({ nom: `${M} ${nom}` }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

// Drizzle enveloppe l'erreur Postgres : la contrainte violée est dans `cause.constraint_name`.
async function contrainteViolee(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
  } catch (erreur) {
    return ((erreur as Error).cause as { constraint_name?: string } | undefined)?.constraint_name;
  }
  return undefined;
}

const identite = { nom: `${M} X` };
const journalValide = (survivantId: string, absorbeId: string) => ({
  contactSurvivantId: survivantId,
  contactAbsorbeId: absorbeId,
  identiteAvantSurvivant: identite,
  identiteAvantAbsorbe: identite,
  identiteFinale: identite,
  choixParChamp: { nom: "survivant" as const, prenom: "identique" as const, email: "absence_comblee" as const, telephone: "absorbe" as const },
  idsDeplaces: { interactions: [], partiesProjet: [], partiesProjetSupprimees: [], partiesProjetRoleCorrige: [], acquereurs: [], prospectsVendeurs: [], referencesExternes: [] },
  avertissementsAcquittes: [],
});

describe("contacts — marqueur de fusion", () => {
  it("A. un contact créé est actif : les deux colonnes sont NULL", async () => {
    const contact = await unContact("Actif");
    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, contact.id));
    expect(ligne.fusionneDansContactId).toBeNull();
    expect(ligne.fusionneLe).toBeNull();
    expect(contact.fusionneDansContactId).toBeUndefined();
    expect(contact.fusionneLe).toBeUndefined();
  });

  it("B. un contact absorbé porte les deux colonnes, et le survivant reste actif", async () => {
    const survivant = await unContact("Survivant B");
    const absorbe = await unContact("Absorbe B");
    const quand = new Date("2026-09-01T10:00:00.000Z");
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: survivant.id, fusionneLe: quand })
      .where(eq(contactsTable.id, absorbe.id));
    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, absorbe.id));
    expect(ligne.fusionneDansContactId).toBe(survivant.id);
    expect(ligne.fusionneLe?.toISOString()).toBe(quand.toISOString());
    const [autre] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, survivant.id));
    expect(autre.fusionneDansContactId).toBeNull();
  });

  it("C. un pointeur sans date est refusé par la base", async () => {
    const survivant = await unContact("Survivant C");
    const absorbe = await unContact("Absorbe C");
    expect(await contrainteViolee(getDb().update(contactsTable).set({ fusionneDansContactId: survivant.id }).where(eq(contactsTable.id, absorbe.id)))).toBe("contacts_fusion_coherente_check");
  });

  it("D. une date sans pointeur est refusée par la base", async () => {
    const contact = await unContact("Date seule");
    expect(await contrainteViolee(getDb().update(contactsTable).set({ fusionneLe: new Date() }).where(eq(contactsTable.id, contact.id)))).toBe("contacts_fusion_coherente_check");
  });

  it("E. un contact ne peut pas être absorbé par lui-même", async () => {
    const contact = await unContact("Soi-même");
    expect(await contrainteViolee(getDb()
        .update(contactsTable)
        .set({ fusionneDansContactId: contact.id, fusionneLe: new Date() })
        .where(eq(contactsTable.id, contact.id)))).toBe("contacts_fusion_pas_soi_meme_check");
  });

  it("F. un survivant inexistant est refusé par la clé étrangère", async () => {
    const contact = await unContact("Vers inconnu");
    expect(await contrainteViolee(getDb()
        .update(contactsTable)
        .set({ fusionneDansContactId: INCONNU, fusionneLe: new Date() })
        .where(eq(contactsTable.id, contact.id)))).toBe("contacts_fusionne_dans_contact_id_contacts_id_fk");
  });
});

describe("contact_fusions — journal", () => {
  it("accepte une ligne complète et typée, sans auteur (nullable)", async () => {
    const survivant = await unContact("Journal S");
    const absorbe = await unContact("Journal A");
    const [ligne] = await getDb().insert(contactFusionsTable).values(journalValide(survivant.id, absorbe.id)).returning();
    idsFusions.push(ligne.id);
    expect(ligne.fusionneLe).toBeInstanceOf(Date);
    expect(ligne.fusionneParSub).toBeNull();
    expect(ligne.fusionneParEmail).toBeNull();
    expect(ligne.choixParChamp.telephone).toBe("absorbe");
    expect(ligne.idsDeplaces.partiesProjetSupprimees).toEqual([]);
    expect(ligne.avertissementsAcquittes).toEqual([]);
  });

  it("refuse un survivant inexistant", async () => {
    const absorbe = await unContact("Journal A2");
    expect(await contrainteViolee(getDb().insert(contactFusionsTable).values(journalValide(INCONNU, absorbe.id)))).toBe("contact_fusions_contact_survivant_id_contacts_id_fk");
  });

  it("refuse un absorbé inexistant", async () => {
    const survivant = await unContact("Journal S3");
    expect(await contrainteViolee(getDb().insert(contactFusionsTable).values(journalValide(survivant.id, INCONNU)))).toBe("contact_fusions_contact_absorbe_id_contacts_id_fk");
  });

  it("refuse survivant = absorbé", async () => {
    const contact = await unContact("Journal même");
    expect(await contrainteViolee(getDb().insert(contactFusionsTable).values(journalValide(contact.id, contact.id)))).toBe("contact_fusions_pas_soi_meme_check");
  });

  it("le journal ne porte aucun workspace_id : feuille de contacts (ADR-054 §7)", () => {
    expect(Object.keys(contactFusionsTable)).not.toContain("workspaceId");
  });
});
