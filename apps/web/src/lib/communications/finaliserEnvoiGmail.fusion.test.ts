import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-059 §10 — la finalisation Gmail APRÈS une fusion : un dossier repointé vers le survivant
// produit une interaction sur le survivant ; une course « contact résolu avant la fusion,
// finalisation après » ne laisse jamais un échange sur l'absorbé — l'email reste envoyé, l'état
// est explicite, aucune référence Gmail orpheline.
const { contactForce } = vi.hoisted(() => ({ contactForce: { id: undefined as string | undefined } }));
vi.mock("@/lib/clientRepository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/clientRepository")>();
  return {
    ...original,
    getContactCanoniqueDeLAcquereur: async (...args: Parameters<typeof original.getContactCanoniqueDeLAcquereur>) =>
      contactForce.id ?? original.getContactCanoniqueDeLAcquereur(...args),
  };
});

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  referencesExternes: referencesExternesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const { finaliserEnvoiGmailReussi } = await import("./finaliserEnvoiGmail");

const M = `Zgmailfusion${Date.now()}`;
let compteur = 0;
const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    const inter = (await getDb().select({ id: interactionsTable.id }).from(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts))).map((i) => i.id);
    if (inter.length > 0) await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.interactionId, inter));
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
  }
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsContacts.length > 0) {
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unContact(nom: string) {
  const contact = await creerContact({ nom: `${M} ${nom}`, email: `${M}.${++compteur}@example.test` }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

async function unDossier(contactId: string) {
  const dossier = await creerAcquereur(
    { prenom: "L", nom: `${M} Dossier`, email: `${M}.d${++compteur}@example.test`, telephone: "0600000000", budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active", notes: "", datePremiereContact: "2026-01-01", contactId },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function absorber(absorbe: Contact, survivant: Contact) {
  const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });
  const resultat = await fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: identite(survivant),
    identiteAttendueAbsorbe: identite(absorbe),
    identiteFinale: { nom: survivant.nom, email: survivant.email },
    choixParChamp: { nom: "survivant", prenom: "identique", email: "survivant", telephone: "identique" },
    acteur: { sub: "test" },
  });
  if (resultat.statut !== "fusionne") throw new Error(resultat.statut);
}

const interactionsDe = (contactId: string) => getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contactId));

describe("finalisation Gmail après fusion", () => {
  it("normal : dossier B repointé vers A → interaction sur A, référence Gmail sur cette interaction", async () => {
    const a = await unContact("A");
    const b = await unContact("B");
    const dossier = await unDossier(b.id);
    await absorber(b, a);

    const resultat = await finaliserEnvoiGmailReussi({
      gmailMessageId: `${M}-normal`,
      survenuLe: "2026-09-10T10:00:00.000Z",
      destinataire: { type: "acquereur", id: dossier.id },
      workspaceId: WORKSPACE_TEST,
    });
    expect(resultat.statut).toBe("interaction_creee");
    if (resultat.statut !== "interaction_creee") return;
    expect((await interactionsDe(a.id)).map((i) => i.id)).toEqual([resultat.interactionId]);
    expect(await interactionsDe(b.id)).toEqual([]);
    const [ref] = await getDb().select().from(referencesExternesTable).where(eq(referencesExternesTable.idExterne, `${M}-normal`));
    expect(ref.interactionId).toBe(resultat.interactionId);
  });

  it("course : contact résolu = B avant la fusion, finalisation après → email_envoye_contact_fusionne, rien sur B, aucune référence", async () => {
    const a = await unContact("A2");
    const b = await unContact("B2");
    const dossier = await unDossier(b.id);
    await absorber(b, a);
    // Ce que la finalisation avait résolu AVANT la fusion : B.
    contactForce.id = b.id;
    try {
      const resultat = await finaliserEnvoiGmailReussi({
        gmailMessageId: `${M}-course`,
        survenuLe: "2026-09-10T10:00:00.000Z",
        destinataire: { type: "acquereur", id: dossier.id },
        workspaceId: WORKSPACE_TEST,
      });
      expect(resultat).toEqual({ statut: "email_envoye_contact_fusionne", contactId: b.id });
    } finally {
      contactForce.id = undefined;
    }
    expect(await interactionsDe(b.id)).toEqual([]);
    expect(await interactionsDe(a.id)).toEqual([]);
    expect(await getDb().select().from(referencesExternesTable).where(eq(referencesExternesTable.idExterne, `${M}-course`))).toEqual([]);
    // Le même message, finalisé à nouveau sur le dossier repointé : cette fois sur A.
    const rejoue = await finaliserEnvoiGmailReussi({
      gmailMessageId: `${M}-course`,
      survenuLe: "2026-09-10T10:00:00.000Z",
      destinataire: { type: "acquereur", id: dossier.id },
      workspaceId: WORKSPACE_TEST,
    });
    expect(rejoue.statut).toBe("interaction_creee");
    expect(await interactionsDe(a.id)).toHaveLength(1);
  });

  it("concurrence réelle : finalisation et fusion en parallèle → jamais d'interaction sur B", async () => {
    for (let essai = 0; essai < 3; essai++) {
      const a = await unContact(`A3-${essai}`);
      const b = await unContact(`B3-${essai}`);
      const dossier = await unDossier(b.id);
      const [finalisation] = await Promise.all([
        finaliserEnvoiGmailReussi({
          gmailMessageId: `${M}-conc-${essai}`,
          survenuLe: "2026-09-10T10:00:00.000Z",
          destinataire: { type: "acquereur", id: dossier.id },
          workspaceId: WORKSPACE_TEST,
        }),
        absorber(b, a),
      ]);
      expect(["interaction_creee", "email_envoye_contact_fusionne"]).toContain(finalisation.statut);
      expect(await interactionsDe(b.id), `essai ${essai}`).toEqual([]);
      if (finalisation.statut === "interaction_creee") {
        expect((await interactionsDe(a.id)).map((i) => i.id)).toEqual([finalisation.interactionId]);
      }
    }
  });
});
