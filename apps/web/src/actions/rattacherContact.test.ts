import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §H — les Server Actions de rattachement ORCHESTRENT : session et workspace depuis le
// contexte, id de dossier depuis le formulaire, UN appel à la primitive, redirection selon le
// résultat. « Créer un contact depuis ce dossier » ne laisse jamais un contact orphelin.
const { sessionMock, workspaceCourantMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  workspaceCourantMock: vi.fn(),
}));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock(), lireSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceCourantMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerContact } = await import("@/lib/contactRepository");
const {
  creerContactDepuisAcquereurAction,
  creerContactDepuisProspectVendeurAction,
  rattacherAcquereurContactExistantAction,
  rattacherProspectVendeurContactExistantAction,
} = await import("./rattacherContact");

const M = `Zactionrattach${Date.now()}`;
let compteur = 0;
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

sessionMock.mockResolvedValue({ sub: "sub-action", email: "conseiller@example.test" });
workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  await getDb().delete(contactsTable).where(like(contactsTable.nom, `${M}%`));
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unAcquereur(workspace = WORKSPACE_TEST) {
  const nom = `${M} Acq ${++compteur}`;
  const dossier = await creerAcquereur(
    { prenom: "Bob", nom, email: `${M}.${compteur}@example.test`, telephone: "0600000000", budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "decouverte", notes: "", datePremiereContact: "2026-01-01" },
    workspace
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unProspect(workspace = WORKSPACE_TEST) {
  const nom = `${M} Pro ${++compteur}`;
  const prospect = await creerProspectVendeur(
    { nom, prenom: "Bob", email: `${M}.${compteur}@example.test`, telephone: undefined, origineLead: undefined, origineLeadDetail: undefined, adresseBienPotentiel: undefined, secteurBienPotentiel: undefined, ville: undefined, codePostal: undefined, typeBien: undefined },
    workspace
  );
  idsProspects.push(prospect.id);
  return prospect;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

// Une Server Action Next signale redirect()/notFound() par une exception porteuse d'un digest.
async function soumettre(action: (fd: FormData) => Promise<void>, fd: FormData): Promise<string> {
  try {
    await action(fd);
    return "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

const contactsPortant = (nom: string) => getDb().select().from(contactsTable).where(eq(contactsTable.nom, nom));
const ligneAcq = async (id: string) => (await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id)))[0]!;
const lignePro = async (id: string) => (await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id)))[0]!;

describe("creerContactDepuisAcquereurAction", () => {
  it("A. succès : un contact créé et rattaché, redirection vers le dossier", async () => {
    const dossier = await unAcquereur();
    const issue = await soumettre(creerContactDepuisAcquereurAction, formulaire({ acquereurId: dossier.id }));
    expect(issue).toContain(`/clients/${dossier.id}`);
    expect(issue).not.toContain("rattachement=");
    const contacts = await contactsPortant(dossier.nom);
    expect(contacts).toHaveLength(1);
    expect((await ligneAcq(dossier.id)).contactId).toBe(contacts[0].id);
  });

  it("B. dossier introuvable : message introuvable, aucun contact ; id absent : notFound()", async () => {
    const avant = (await getDb().select().from(contactsTable).where(like(contactsTable.nom, `${M}%`))).length;
    const inconnu = "00000000-0000-4000-8000-000000000000";
    expect(await soumettre(creerContactDepuisAcquereurAction, formulaire({ acquereurId: inconnu }))).toContain(`/clients/${inconnu}?rattachement=introuvable`);
    expect(await soumettre(creerContactDepuisAcquereurAction, formulaire({}))).toMatch(/404|NOT_FOUND/);
    expect((await getDb().select().from(contactsTable).where(like(contactsTable.nom, `${M}%`))).length).toBe(avant);
  });

  it("C. dossier d'un autre workspace : indistinguable d'un dossier introuvable, rien copié, rien changé", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre action rattachement" });
    idsWorkspaces.push(autre);
    const dossier = await unAcquereur(autre);
    const issue = await soumettre(creerContactDepuisAcquereurAction, formulaire({ acquereurId: dossier.id }));
    expect(issue).toContain(`/clients/${dossier.id}?rattachement=introuvable`);
    expect(await contactsPortant(dossier.nom)).toHaveLength(0);
    expect((await ligneAcq(dossier.id)).contactId).toBeNull();
  });

  it("D. dossier déjà rattaché : deja_rattache, aucun nouveau contact", async () => {
    const dossier = await unAcquereur();
    await soumettre(creerContactDepuisAcquereurAction, formulaire({ acquereurId: dossier.id }));
    const issue = await soumettre(creerContactDepuisAcquereurAction, formulaire({ acquereurId: dossier.id }));
    expect(issue).toContain(`/clients/${dossier.id}?rattachement=deja_rattache`);
    expect(await contactsPortant(dossier.nom)).toHaveLength(1);
  });

  it("E. double soumission concurrente : un seul contact, l'autre tentative refusée proprement", async () => {
    const dossier = await unAcquereur();
    const fd = formulaire({ acquereurId: dossier.id });
    const issues = await Promise.all([
      soumettre(creerContactDepuisAcquereurAction, fd),
      soumettre(creerContactDepuisAcquereurAction, fd),
    ]);
    expect(issues.filter((i) => i.includes("rattachement=deja_rattache"))).toHaveLength(1);
    expect(issues.filter((i) => i.includes(`/clients/${dossier.id};`) && !i.includes("rattachement="))).toHaveLength(1);
    const contacts = await contactsPortant(dossier.nom);
    expect(contacts).toHaveLength(1);
    expect((await ligneAcq(dossier.id)).contactId).toBe(contacts[0].id);
  });

  it("G/H. le workspace vient de la session ; un champ workspaceId du formulaire est ignoré", async () => {
    const autre = `${M}-ws2`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre action rattachement 2" });
    idsWorkspaces.push(autre);
    const dossier = await unAcquereur(autre);
    const issue = await soumettre(creerContactDepuisAcquereurAction, formulaire({ acquereurId: dossier.id, workspaceId: autre }));
    expect(issue).toContain("rattachement=introuvable");
    expect(await contactsPortant(dossier.nom)).toHaveLength(0);
    expect(workspaceCourantMock).toHaveBeenCalled();
  });
});

describe("creerContactDepuisProspectVendeurAction", () => {
  it("A. succès : un contact créé et rattaché, redirection vers le dossier", async () => {
    const prospect = await unProspect();
    const issue = await soumettre(creerContactDepuisProspectVendeurAction, formulaire({ prospectId: prospect.id }));
    expect(issue).toContain(`/prospects-vendeurs/${prospect.id}`);
    expect(issue).not.toContain("rattachement=");
    const contacts = await contactsPortant(prospect.nom);
    expect(contacts).toHaveLength(1);
    expect((await lignePro(prospect.id)).contactId).toBe(contacts[0].id);
  });

  it("B. dossier introuvable : message introuvable ; id absent : notFound()", async () => {
    const inconnu = "00000000-0000-4000-8000-000000000000";
    expect(await soumettre(creerContactDepuisProspectVendeurAction, formulaire({ prospectId: inconnu }))).toContain(`/prospects-vendeurs/${inconnu}?rattachement=introuvable`);
    expect(await soumettre(creerContactDepuisProspectVendeurAction, formulaire({}))).toMatch(/404|NOT_FOUND/);
  });

  it("C. dossier d'un autre workspace : introuvable, rien copié", async () => {
    const autre = `${M}-ws3`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre action rattachement 3" });
    idsWorkspaces.push(autre);
    const prospect = await unProspect(autre);
    const issue = await soumettre(creerContactDepuisProspectVendeurAction, formulaire({ prospectId: prospect.id, workspaceId: autre }));
    expect(issue).toContain(`/prospects-vendeurs/${prospect.id}?rattachement=introuvable`);
    expect(await contactsPortant(prospect.nom)).toHaveLength(0);
    expect((await lignePro(prospect.id)).contactId).toBeNull();
  });

  it("D. déjà rattaché : deja_rattache, aucun nouveau contact", async () => {
    const prospect = await unProspect();
    await soumettre(creerContactDepuisProspectVendeurAction, formulaire({ prospectId: prospect.id }));
    const issue = await soumettre(creerContactDepuisProspectVendeurAction, formulaire({ prospectId: prospect.id }));
    expect(issue).toContain("rattachement=deja_rattache");
    expect(await contactsPortant(prospect.nom)).toHaveLength(1);
  });

  it("E. double soumission concurrente : un seul contact", async () => {
    const prospect = await unProspect();
    const fd = formulaire({ prospectId: prospect.id });
    const issues = await Promise.all([
      soumettre(creerContactDepuisProspectVendeurAction, fd),
      soumettre(creerContactDepuisProspectVendeurAction, fd),
    ]);
    expect(issues.filter((i) => i.includes("rattachement=deja_rattache"))).toHaveLength(1);
    const contacts = await contactsPortant(prospect.nom);
    expect(contacts).toHaveLength(1);
    expect((await lignePro(prospect.id)).contactId).toBe(contacts[0].id);
  });
});

describe("rattacher à un contact EXISTANT — non-régression", () => {
  it("acquéreur et vendeur : rattachement réussi, puis deja_rattache, aucun contact créé", async () => {
    const contact = await creerContact({ nom: `${M} Existant`, prenom: "Alice" }, WORKSPACE_TEST);
    const dossier = await unAcquereur();
    const prospect = await unProspect();
    expect(await soumettre(rattacherAcquereurContactExistantAction, formulaire({ acquereurId: dossier.id, contactId: contact.id }))).toContain(`/clients/${dossier.id}`);
    expect(await soumettre(rattacherProspectVendeurContactExistantAction, formulaire({ prospectId: prospect.id, contactId: contact.id }))).toContain(`/prospects-vendeurs/${prospect.id}`);
    expect((await ligneAcq(dossier.id)).contactId).toBe(contact.id);
    expect((await lignePro(prospect.id)).contactId).toBe(contact.id);
    expect(await soumettre(rattacherAcquereurContactExistantAction, formulaire({ acquereurId: dossier.id, contactId: contact.id }))).toContain("rattachement=deja_rattache");
    expect(await contactsPortant(dossier.nom)).toHaveLength(0);
    expect(await contactsPortant(prospect.nom)).toHaveLength(0);
  });
});
