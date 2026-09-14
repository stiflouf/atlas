import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-059 — ce que le repository Contact garantit face à un contact ABSORBÉ : le writer d'identité
// le refuse (même sans écran), la lecture générique le rend avec son marqueur, et la résolution
// suit la chaîne jusqu'au contact actif — bornée, sans jamais boucler.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { contacts: contactsTable, champsVerrouilles: champsVerrouillesTable } = await import("@/db/schema");
const { creerContact, getContactDuWorkspace, modifierIdentiteContact, resoudreContactActif } = await import(
  "@/lib/contactRepository"
);
const { estContactFusionne, MAX_CHAINE_FUSION } = await import("@/lib/contactFusion");

const M = `Zrepofusion${Date.now()}`;
const idsContacts: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    // Les pointeurs de fusion référencent d'autres contacts du lot : les lever avant de supprimer.
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: null, fusionneLe: null })
      .where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unContact(nom: string, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} ${nom}` }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

// État posé directement en base : aucun moteur de fusion n'existe (ADR-059, lot à part).
async function absorber(absorbeId: string, survivantId: string) {
  await getDb()
    .update(contactsTable)
    .set({ fusionneDansContactId: survivantId, fusionneLe: new Date() })
    .where(eq(contactsTable.id, absorbeId));
}

describe("estContactFusionne", () => {
  it("un contact créé est actif ; un contact absorbé ne l'est plus", async () => {
    const survivant = await unContact("Actif");
    const absorbe = await unContact("Absorbe");
    expect(estContactFusionne(survivant)).toBe(false);
    await absorber(absorbe.id, survivant.id);
    const relu = (await getContactDuWorkspace(absorbe.id, WORKSPACE_TEST))!;
    expect(estContactFusionne(relu)).toBe(true);
    expect(relu.fusionneDansContactId).toBe(survivant.id);
    expect(relu.fusionneLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("modifierIdentiteContact — contact absorbé", () => {
  it("refuse d'écrire : identité, modifie_le et verrous inchangés", async () => {
    const survivant = await unContact("Writer S");
    const absorbe = await unContact("Writer A");
    await absorber(absorbe.id, survivant.id);
    const [avant] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, absorbe.id));

    await expect(
      modifierIdentiteContact(absorbe.id, { nom: `${M} Réécrit`, email: "x@example.test" }, WORKSPACE_TEST)
    ).rejects.toThrow(/fusionné/);

    const [apres] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, absorbe.id));
    expect(apres).toEqual(avant);
    const verrous = await getDb()
      .select()
      .from(champsVerrouillesTable)
      .where(eq(champsVerrouillesTable.contactId, absorbe.id));
    expect(verrous).toEqual([]);
  });

  it("le survivant, lui, reste modifiable", async () => {
    const survivant = await unContact("Writer S2");
    const absorbe = await unContact("Writer A2");
    await absorber(absorbe.id, survivant.id);
    const modifie = await modifierIdentiteContact(survivant.id, { nom: `${M} Survivant corrigé` }, WORKSPACE_TEST);
    expect(modifie?.nom).toBe(`${M} Survivant corrigé`);
  });
});

describe("resoudreContactActif", () => {
  it("un contact actif se résout sur lui-même, chaîne vide", async () => {
    const contact = await unContact("Direct");
    expect(await resoudreContactActif(contact.id, WORKSPACE_TEST)).toEqual({
      statut: "actif",
      contact: expect.objectContaining({ id: contact.id }),
      chaine: [],
    });
  });

  it("A → B → C : résout C en passant par A puis B, sans compaction en base", async () => {
    const c = await unContact("Chaîne C");
    const b = await unContact("Chaîne B");
    const a = await unContact("Chaîne A");
    await absorber(b.id, c.id);
    await absorber(a.id, b.id);

    const resolution = await resoudreContactActif(a.id, WORKSPACE_TEST);
    expect(resolution).toEqual({ statut: "actif", contact: expect.objectContaining({ id: c.id }), chaine: [a.id, b.id] });
    // A pointe toujours B, jamais réécrit vers C.
    expect((await getContactDuWorkspace(a.id, WORKSPACE_TEST))?.fusionneDansContactId).toBe(b.id);
  });

  it("introuvable : id invalide, inconnu ou d'un autre workspace", async () => {
    expect(await resoudreContactActif("pas-un-uuid", WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
    expect(await resoudreContactActif("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toEqual({
      statut: "introuvable",
    });
  });

  it("cycle A → B → A : état explicite, jamais une boucle", async () => {
    const a = await unContact("Cycle A");
    const b = await unContact("Cycle B");
    await absorber(a.id, b.id);
    await absorber(b.id, a.id);
    expect(await resoudreContactActif(a.id, WORKSPACE_TEST)).toEqual({ statut: "chaine_invalide" });
  });

  it("au-delà de MAX_CHAINE_FUSION maillons : état explicite", async () => {
    expect(MAX_CHAINE_FUSION).toBe(10);
    const actif = await unContact("Profond actif");
    let suivant = actif;
    const absorbes: string[] = [];
    for (let i = 0; i < MAX_CHAINE_FUSION + 1; i++) {
      const maillon = await unContact(`Profond ${i}`);
      await absorber(maillon.id, suivant.id);
      absorbes.push(maillon.id);
      suivant = maillon;
    }
    // Le dernier créé est à 11 sauts de l'actif : refusé. Celui juste avant est à 10 : résolu.
    expect(await resoudreContactActif(absorbes[MAX_CHAINE_FUSION], WORKSPACE_TEST)).toEqual({ statut: "chaine_invalide" });
    expect((await resoudreContactActif(absorbes[MAX_CHAINE_FUSION - 1], WORKSPACE_TEST)).statut).toBe("actif");
  });
});
