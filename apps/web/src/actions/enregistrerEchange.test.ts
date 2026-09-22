import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// CRM_TIMELINE_V1 — `enregistrerEchangeAction` suit FORM_FEEDBACK_V1 : refus de saisie et refus
// métier attendus → état `{ statut: "erreur" }` (jamais error.tsx), succès → redirection vers la
// fiche Contact, session absente / panne → lève. Session et workspace mockés, base réelle.
const { sessionMock, workspaceMock } = vi.hoisted(() => ({ sessionMock: vi.fn(), workspaceMock: vi.fn() }));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { contacts: contactsTable, interactions: interactionsTable, prospectsVendeurs: prospectsVendeursTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerEchangeAction } = await import("./enregistrerEchange");

const M = `Zaction${Date.now()}`;
const WORKSPACE_B = `ws-action-echange-${Date.now()}`;
const idsContacts: string[] = [];
const idsProspects: string[] = [];
let workspaceBCree = false;

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.test" });
  workspaceMock.mockReset().mockResolvedValue(WORKSPACE_TEST);
});

afterAll(async () => {
  if (idsContacts.length > 0) await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function unContact(workspaceId = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Contact` }, workspaceId);
  idsContacts.push(contact.id);
  return contact;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

const valide = (contactId: string, surcharge: Record<string, string> = {}) => ({
  contactId,
  echange: "appel_sortant",
  survenuLe: "2026-09-01T10:30",
  contenu: "Point sur le calendrier de vente.",
  ...surcharge,
});

async function digestRedirection(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
    return "aucune redirection";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

describe("enregistrerEchangeAction — FORM_FEEDBACK_V1", () => {
  it("succès : une interaction canonique est écrite et l'action redirige vers la fiche Contact", async () => {
    const contact = await unContact();
    expect(await digestRedirection(enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contact.id))))).toContain(`NEXT_REDIRECT;replace;/contacts/${contact.id}`);
    const [ligne] = await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contact.id));
    expect(ligne).toMatchObject({ type: "appel", sens: "sortant", contenu: "Point sur le calendrier de vente." });
    // `datetime-local` sans fuseau = heure de Paris (UTC+2 en septembre).
    expect(ligne.survenuLe.toISOString()).toBe("2026-09-01T08:30:00.000Z");
  });

  it("type inconnu, contenu vide, date absente, date future, contexte mal formé → état erreur, rien n'est écrit", async () => {
    const contact = await unContact();
    const dansUneHeure = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const cas: Array<[Record<string, string>, RegExp]> = [
      [{ echange: "pigeon_voyageur" }, /type d'échange/],
      [{ contenu: "   " }, /contenu est obligatoire/],
      [{ survenuLe: "" }, /date et l'heure/],
      [{ survenuLe: "pas-une-date" }, /date et l'heure/],
      [{ survenuLe: dansUneHeure }, /date future/],
      [{ contexte: "visite:00000000-0000-4000-8000-000000000000" }, /contexte choisi/],
      [{ contexte: "bien:00000000-0000-4000-8000-000000000000" }, /pas relié à ce contact/],
      [{ contactId: "pas-un-uuid" }, /Contact introuvable/],
    ];
    for (const [surcharge, attendu] of cas) {
      const etat = await enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contact.id, surcharge)));
      expect(etat.statut, JSON.stringify(surcharge)).toBe("erreur");
      expect(etat.statut === "erreur" && etat.message, JSON.stringify(surcharge)).toMatch(attendu);
    }
    expect(await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contact.id))).toEqual([]);
  });

  it("une légère dérive d'horloge (quelques secondes dans le futur) est tolérée", async () => {
    const contact = await unContact();
    const dansTrenteSecondes = new Date(Date.now() + 30 * 1000).toISOString();
    expect(await digestRedirection(enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contact.id, { survenuLe: dansTrenteSecondes }))))).toContain("NEXT_REDIRECT");
  });

  it("contact d'un autre workspace → état erreur (introuvable dans votre espace), rien n'est écrit", async () => {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] action échange B" });
    workspaceBCree = true;
    const contactB = await unContact(WORKSPACE_B);
    const etat = await enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contactB.id)));
    expect(etat).toEqual({ statut: "erreur", message: "Contact introuvable dans votre espace." });
    expect(await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contactB.id))).toEqual([]);
  });

  it("note interne : écrite comme note/interne, sans toucher dernier_contact_le ; appel : l'avance", async () => {
    const contact = await unContact();
    const prospect = await creerProspectVendeur({ nom: `${M} Prospect`, contactId: contact.id }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    await digestRedirection(enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contact.id, { echange: "note_interne", contenu: "Pense-bête" }))));
    let [ligne] = await getDb().select({ d: prospectsVendeursTable.dernierContactLe }).from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospect.id));
    expect(ligne.d).toBeNull();
    const note = (await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contact.id)))[0];
    expect(note).toMatchObject({ type: "note", sens: "interne", contenu: "Pense-bête" });

    await digestRedirection(enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contact.id, { echange: "rendez_vous", survenuLe: "2026-09-02T09:00" }))));
    [ligne] = await getDb().select({ d: prospectsVendeursTable.dernierContactLe }).from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospect.id));
    expect(ligne.d?.toISOString()).toBe("2026-09-02T07:00:00.000Z");
    const rdv = (await getDb().select().from(interactionsTable).where(eq(interactionsTable.type, "rendez_vous")).then((l) => l.filter((i) => i.contactId === contact.id)))[0];
    expect(rdv.sens).toBeNull();
  });

  it("sans session : lève AVANT toute validation (fail-closed) ; panne base : lève, jamais un état erreur", async () => {
    sessionMock.mockRejectedValueOnce(new Error("NON_AUTHENTIFIE"));
    await expect(enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire({ echange: "pigeon" }))).rejects.toThrow("NON_AUTHENTIFIE");

    const contact = await unContact();
    workspaceMock.mockRejectedValueOnce(new Error("PANNE_WORKSPACE"));
    await expect(enregistrerEchangeAction(ETAT_FORMULAIRE_INITIAL, formulaire(valide(contact.id)))).rejects.toThrow("PANNE_WORKSPACE");
  });
});
