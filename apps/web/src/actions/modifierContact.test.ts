import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-057 — corriger l'identité canonique DEPUIS LA FICHE CONTACT. Ce fichier ferme la boucle
// depuis l'autre bout que modifierAcquereur.identite.test.ts : la correction part du Contact, et
// toutes ses projections (acquéreur, vendeur, destinataire d'email, recherche) la reflètent, sans
// qu'un seul instantané historique ne soit réécrit.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contacts: contactsTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact, getContactById } = await import("@/lib/contactRepository");
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { creerProspectVendeur, getProspectVendeurById } = await import("@/lib/prospectVendeurRepository");
const { versCandidatAcquereur, versCandidatProspectVendeur } = await import("@/lib/communications/destinataireCommunication");
const { rechercherContacts } = await import("@/lib/rechercheContactRepository");
const { modifierContactAction } = await import("./modifierContact");

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

const M = `Zedit${Date.now()}`;

const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0)
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(surcharge: Record<string, unknown> = {}, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Dupont`, prenom: "Jean", ...surcharge } as never, workspace);
  idsContacts.push(contact.id);
  return contact;
}

function formulaire(id: string, champs: { nom?: string; prenom?: string; email?: string; telephone?: string }): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("nom", champs.nom ?? "");
  formData.set("prenom", champs.prenom ?? "");
  formData.set("email", champs.email ?? "");
  formData.set("telephone", champs.telephone ?? "");
  return formData;
}

// `redirect()` et `notFound()` lèvent par conception (Next.js) : on capture le digest pour
// distinguer un succès (redirection vers la fiche) d'un refus.
async function soumettre(formData: FormData): Promise<string> {
  try {
    await modifierContactAction(formData);
    return "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

async function verrous(contactId: string): Promise<string[]> {
  const lignes = await getDb()
    .select({ champ: champsVerrouillesTable.champ })
    .from(champsVerrouillesTable)
    .where(eq(champsVerrouillesTable.contactId, contactId));
  return lignes.map((l) => l.champ).sort();
}

describe("modifierContactAction — écriture canonique", () => {
  it("A/B. modifie le nom et le prénom, puis redirige vers la fiche", async () => {
    const contact = await unContact();

    const issue = await soumettre(formulaire(contact.id, { nom: `${M} Nouveau`, prenom: "Jeanne" }));

    expect(issue).toContain(`NEXT_REDIRECT;replace;/contacts/${contact.id}`);
    const relu = (await getContactById(contact.id))!;
    expect(relu.nom).toBe(`${M} Nouveau`);
    expect(relu.prenom).toBe("Jeanne");
  });

  it("C/D. ajoute puis supprime un email : une chaîne vide devient une absence, jamais « »", async () => {
    const contact = await unContact();
    expect(contact.email).toBeUndefined();

    await soumettre(formulaire(contact.id, { nom: contact.nom, prenom: "Jean", email: `${M}@example.test` }));
    expect((await getContactById(contact.id))!.email).toBe(`${M}@example.test`);

    await soumettre(formulaire(contact.id, { nom: contact.nom, prenom: "Jean", email: "" }));
    const relu = (await getContactById(contact.id))!;
    expect(relu.email).toBeUndefined();
    const [brut] = await getDb().select({ email: contactsTable.email }).from(contactsTable).where(eq(contactsTable.id, contact.id));
    expect(brut!.email).toBeNull();
  });

  it("E/F. ajoute puis supprime un téléphone, et un prénom, avec la même sémantique", async () => {
    const contact = await unContact({ prenom: undefined });

    await soumettre(formulaire(contact.id, { nom: contact.nom, telephone: " 0611223344 ", prenom: " Léa " }));
    let relu = (await getContactById(contact.id))!;
    expect(relu.telephone).toBe("0611223344");
    expect(relu.prenom).toBe("Léa");

    await soumettre(formulaire(contact.id, { nom: contact.nom, telephone: "   ", prenom: "" }));
    relu = (await getContactById(contact.id))!;
    expect(relu.telephone).toBeUndefined();
    expect(relu.prenom).toBeUndefined();
  });

  it("le nom est obligatoire : vide ou blanc est refusé, rien n'est écrit", async () => {
    const contact = await unContact();

    const issue = await soumettre(formulaire(contact.id, { nom: "   ", prenom: "Jean" }));

    expect(issue).toContain("Le nom est obligatoire.");
    expect((await getContactById(contact.id))!.nom).toBe(contact.nom);
  });
});

describe("modifierContactAction — verrous, modifie_le, no-op", () => {
  it("J. seul le champ réellement changé est verrouillé", async () => {
    const contact = await unContact({ email: `${M}.avant@example.test`, telephone: "0600000000" });

    await soumettre(
      formulaire(contact.id, { nom: contact.nom, prenom: "Jean", email: `${M}.apres@example.test`, telephone: "0600000000" })
    );

    expect(await verrous(contact.id)).toEqual(["email"]);
  });

  it("K. modifie_le avance quand un champ change", async () => {
    const contact = await unContact();
    await new Promise((r) => setTimeout(r, 5));

    await soumettre(formulaire(contact.id, { nom: `${M} Change`, prenom: "Jean" }));

    const relu = (await getContactById(contact.id))!;
    expect(new Date(relu.modifieLe).getTime()).toBeGreaterThan(new Date(contact.modifieLe).getTime());
  });

  it("G. une soumission à l'identique est un no-op : aucun verrou, modifie_le inchangé, redirection quand même", async () => {
    const contact = await unContact({ email: `${M}.noop@example.test`, telephone: "0600000001" });
    await new Promise((r) => setTimeout(r, 5));

    const issue = await soumettre(
      formulaire(contact.id, { nom: contact.nom, prenom: "Jean", email: `${M}.noop@example.test`, telephone: " 0600000001 " })
    );

    expect(issue).toContain(`NEXT_REDIRECT;replace;/contacts/${contact.id}`);
    expect(await verrous(contact.id)).toEqual([]);
    expect((await getContactById(contact.id))!.modifieLe).toBe(contact.modifieLe);
  });
});

describe("modifierContactAction — périmètre", () => {
  it("H. un contact d'un autre workspace est introuvable : notFound(), rien n'est écrit", async () => {
    const autre = `test-edit-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre edit" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact({}, autre);

    const issue = await soumettre(formulaire(ailleurs.id, { nom: `${M} Intrusion`, prenom: "X" }));

    expect(issue).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    expect((await getContactById(ailleurs.id))!.nom).toBe(ailleurs.nom);
  });

  it("I. id inconnu ou invalide : notFound()", async () => {
    expect(await soumettre(formulaire("00000000-0000-4000-8000-000000000000", { nom: "X" }))).toMatch(/404|NOT_FOUND/);
    expect(await soumettre(formulaire("pas-un-uuid", { nom: "X" }))).toMatch(/404|NOT_FOUND/);
  });
});

describe("modifierContactAction — coexistence avec l'historique", () => {
  async function unContactMultiRole() {
    const contact = await unContact({ email: `${M}.canon@example.test`, telephone: "0600000002" });
    const acquereur = await creerAcquereur(
      {
        prenom: "Jean",
        nom: `${M} Ancien`,
        email: `${M}.ancien@example.test`,
        telephone: "0699999999",
        budgetMin: 100_000,
        budgetMax: 400_000,
        criteres: [],
        stadeProjet: "recherche_active",
        notes: "",
        datePremiereContact: "2026-01-01",
        contactId: contact.id,
      },
      WORKSPACE_TEST
    );
    idsAcquereurs.push(acquereur.id);
    const prospect = await creerProspectVendeur(
      {
        nom: `${M} Ancien`,
        prenom: "Jean",
        email: `${M}.ancien@example.test`,
        telephone: "0699999999",
        origineLead: undefined,
        origineLeadDetail: undefined,
        adresseBienPotentiel: undefined,
        secteurBienPotentiel: undefined,
        ville: undefined,
        codePostal: undefined,
        typeBien: undefined,
        contactId: contact.id,
      },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);
    return { contact, acquereur, prospect };
  }

  it("L/M. multi-rôle : les projections acquéreur et vendeur convergent, les instantanés legacy restent intacts", async () => {
    const { contact, acquereur, prospect } = await unContactMultiRole();

    await soumettre(
      formulaire(contact.id, { nom: `${M} Nouveau`, prenom: "Jeanne", email: `${M}.nouveau@example.test`, telephone: "0611111111" })
    );

    // Projections : lues via les repositories, donc via le pont ADR-057.
    const acqProjete = (await getClientById(acquereur.id))!;
    const proProjete = (await getProspectVendeurById(prospect.id))!;
    expect(acqProjete).toMatchObject({ nom: `${M} Nouveau`, prenom: "Jeanne", email: `${M}.nouveau@example.test` });
    expect(proProjete).toMatchObject({ nom: `${M} Nouveau`, prenom: "Jeanne", email: `${M}.nouveau@example.test` });

    // Instantanés : les lignes brutes n'ont pas bougé.
    const [acqBrut] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, acquereur.id));
    const [proBrut] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospect.id));
    expect(acqBrut).toMatchObject({ nom: `${M} Ancien`, email: `${M}.ancien@example.test`, contactId: contact.id });
    expect(proBrut).toMatchObject({ nom: `${M} Ancien`, email: `${M}.ancien@example.test`, contactId: contact.id });
  });

  it("Gmail suit le nouvel email des deux côtés, sans code Gmail", async () => {
    const { contact, acquereur, prospect } = await unContactMultiRole();

    await soumettre(
      formulaire(contact.id, { nom: contact.nom, prenom: "Jean", email: `${M}.gmail@example.test`, telephone: "0600000002" })
    );

    expect(versCandidatAcquereur((await getClientById(acquereur.id))!).email).toBe(`${M}.gmail@example.test`);
    expect(versCandidatProspectVendeur((await getProspectVendeurById(prospect.id))!).email).toBe(`${M}.gmail@example.test`);
  });

  it("O. aucun relink : les contact_id des dossiers ne bougent pas, aucun contact n'est créé", async () => {
    const { contact, acquereur, prospect } = await unContactMultiRole();
    const avant = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.workspaceId, WORKSPACE_TEST));

    await soumettre(formulaire(contact.id, { nom: `${M} Relink`, prenom: "Jean" }));

    const [acq] = await getDb().select({ contactId: acquereursTable.contactId }).from(acquereursTable).where(eq(acquereursTable.id, acquereur.id));
    const [pro] = await getDb().select({ contactId: prospectsVendeursTable.contactId }).from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospect.id));
    const apres = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.workspaceId, WORKSPACE_TEST));
    expect(acq!.contactId).toBe(contact.id);
    expect(pro!.contactId).toBe(contact.id);
    expect(apres).toHaveLength(avant.length);
  });

  it("N. un email devenu identique à celui d'un autre Contact est autorisé : deux Contacts, aucune fusion", async () => {
    const x = `${M}.partage@example.test`;
    const a = await unContact({ nom: `${M} A`, email: x });
    const b = await unContact({ nom: `${M} B`, email: `${M}.b@example.test` });

    const issue = await soumettre(formulaire(b.id, { nom: `${M} B`, prenom: "Jean", email: x }));

    expect(issue).toContain("NEXT_REDIRECT");
    const memes = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.email, x));
    expect(memes.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("la recherche retrouve la nouvelle identité, et l'ancienne ne réinjecte pas le Contact", async () => {
    const contact = await unContact({ nom: `${M} Avantrecherche`, email: `${M}.avant.rech@example.test` });

    await soumettre(formulaire(contact.id, { nom: `${M} Apresrecherche`, prenom: "Jean", email: `${M}.apres.rech@example.test` }));

    const nouveau = await rechercherContacts({ workspaceId: WORKSPACE_TEST, q: `${M}.apres.rech@example.test` });
    expect(nouveau.items.map((i) => i.contactId)).toEqual([contact.id]);
    const ancien = await rechercherContacts({ workspaceId: WORKSPACE_TEST, q: `${M}.avant.rech@example.test` });
    expect(ancien.items).toEqual([]);
  });

  it("un Contact sans aucun dossier ni projet est modifiable", async () => {
    const seul = await unContact({ nom: `${M} Seul` });
    const issue = await soumettre(formulaire(seul.id, { nom: `${M} Seul modifie`, prenom: "Jean" }));
    expect(issue).toContain("NEXT_REDIRECT");
    expect((await getContactById(seul.id))!.nom).toBe(`${M} Seul modifie`);
  });
});
