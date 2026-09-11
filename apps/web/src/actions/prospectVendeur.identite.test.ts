import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-057 — L'IDENTITÉ CANONIQUE CÔTÉ VENDEUR, et surtout la preuve que Contact tient sa promesse :
// une personne, une identité, quel que soit le rôle sous lequel on la regarde. Les deux tests
// multi-rôles de ce fichier sont la raison d'être du modèle — sans eux, Contact ne serait qu'une
// table de plus à tenir à jour.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact, getContactById } = await import("@/lib/contactRepository");
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { creerProspectVendeur, getProspectVendeurById, listerProspectsVendeurs } = await import(
  "@/lib/prospectVendeurRepository"
);
const { modifierProspectVendeurAction } = await import("./prospectVendeur");
const { versCandidatProspectVendeur } = await import("@/lib/communications/destinataireCommunication");

const IDENTITE_A = { nom: "[test réel] Vendeur A", prenom: "Jean", email: "ancienne@example.test", telephone: "0600000000" };
const IDENTITE_D = { nom: "[test réel] Vendeur D", prenom: "Jeanne", email: "nouvelle@example.test", telephone: "0611111111" };

const idsProspects: string[] = [];
const idsAcquereurs: string[] = [];
const idsContacts: string[] = [];
const idsProjets: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsProspects.length > 0) {
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  if (idsAcquereurs.length > 0) {
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereurs));
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
  if (idsProjets.length > 0) {
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.projetVendeurId, idsProjets));
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjets));
  }
  if (idsContacts.length > 0) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsWorkspaces.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
  }
});

function formulaire(id: string, identite = IDENTITE_D): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("nom", identite.nom);
  formData.set("prenom", identite.prenom);
  formData.set("email", identite.email);
  formData.set("telephone", identite.telephone);
  return formData;
}

// `redirect()` lève par conception (Next.js) : l'attraper est la seule façon d'observer l'effet.
const enregistrer = (formData: FormData) => modifierProspectVendeurAction(formData).catch(() => {});

async function unContact(suffixe: string, surcharge: Record<string, unknown> = {}) {
  const contact = await creerContact({ ...IDENTITE_A, nom: `${IDENTITE_A.nom} ${suffixe}`, ...surcharge }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

async function unProspect(suffixe: string, contactId?: string) {
  const prospect = await creerProspectVendeur(
    {
      ...IDENTITE_A,
      nom: `${IDENTITE_A.nom} ${suffixe}`,
      origineLead: undefined,
      origineLeadDetail: undefined,
      adresseBienPotentiel: undefined,
      secteurBienPotentiel: undefined,
      ville: undefined,
      codePostal: undefined,
      typeBien: undefined,
      contactId,
    },
    WORKSPACE_TEST
  );
  idsProspects.push(prospect.id);
  return prospect;
}

async function ligneProspect(id: string) {
  const [ligne] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  return ligne!;
}

describe("ADR-057 vendeur — lecture effective", () => {
  it("un prospect rattaché rend l'identité du Contact", async () => {
    const contact = await unContact("lecture");
    const prospect = await unProspect("lecture", contact.id);
    await getDb()
      .update(contactsTable)
      .set({ nom: "Dupont", prenom: "Jeanne", email: "canonique@example.test", telephone: "0655555555" })
      .where(eq(contactsTable.id, contact.id));

    const relu = await getProspectVendeurById(prospect.id);

    expect(relu?.nom).toBe("Dupont");
    expect(relu?.email).toBe("canonique@example.test");
    expect(relu?.telephone).toBe("0655555555");
  });

  it("un Contact sans email ne récupère JAMAIS celui du dossier", async () => {
    const contact = await unContact("nuls", { email: undefined, telephone: undefined, nom: "Dupont", prenom: "Jeanne" });
    const prospect = await unProspect("nuls", contact.id);

    const relu = await getProspectVendeurById(prospect.id);

    expect(relu?.nom).toBe("Dupont");
    expect(relu?.prenom).toBe("Jeanne");
    expect(relu?.email).toBeUndefined();
    expect(relu?.telephone).toBeUndefined();
    // Le dossier porte bien encore l'ancienne adresse — le test ne passe pas par accident.
    expect((await ligneProspect(prospect.id)).email).toBe(IDENTITE_A.email);
  });

  it("un prospect historique garde son identité legacy", async () => {
    const prospect = await unProspect("historique-lecture");
    const relu = await getProspectVendeurById(prospect.id);
    expect(relu?.email).toBe(IDENTITE_A.email);
  });

  it("les listes servent la même identité effective que la fiche", async () => {
    const contact = await unContact("liste");
    const prospect = await unProspect("liste", contact.id);
    await getDb().update(contactsTable).set({ email: "liste@example.test" }).where(eq(contactsTable.id, contact.id));

    const dansLaListe = (await listerProspectsVendeurs()).find((p) => p.id === prospect.id);
    expect(dansLaListe?.email).toBe("liste@example.test");
  });
});

describe("ADR-057 vendeur — écriture", () => {
  it("édition humaine -> Contact seul ; le dossier reste l'instantané de création", async () => {
    const contact = await unContact("ecriture");
    const prospect = await unProspect("ecriture", contact.id);
    const avant = await getContactById(contact.id);

    // Même précaution que côté acquéreur : `cree_le`/`modifie_le` initial viennent de l'horloge
    // POSTGRES, l'UPDATE de l'horloge NODE. Comparer les deux dépendrait de leur dérive.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(avant!.modifieLe).getTime() + 1000));

    await enregistrer(formulaire(prospect.id));

    vi.useRealTimers();

    const apres = await getContactById(contact.id);
    expect(apres?.nom).toBe(IDENTITE_D.nom);
    expect(apres?.email).toBe(IDENTITE_D.email);
    expect(new Date(apres!.modifieLe).getTime()).toBeGreaterThan(new Date(avant!.modifieLe).getTime());

    const legacy = await ligneProspect(prospect.id);
    expect(legacy.email).toBe(IDENTITE_A.email);
    expect(legacy.nom).toBe(`${IDENTITE_A.nom} ecriture`);

    expect((await getProspectVendeurById(prospect.id))?.email).toBe(IDENTITE_D.email);
  });

  it("un prospect historique écrit son identité en legacy, sans créer de Contact", async () => {
    const prospect = await unProspect("historique-ecriture");
    const contactsAvant = await getDb().select({ id: contactsTable.id }).from(contactsTable);

    await enregistrer(formulaire(prospect.id));

    const legacy = await ligneProspect(prospect.id);
    expect(legacy.email).toBe(IDENTITE_D.email);
    expect(legacy.contactId).toBeNull();
    expect((await getDb().select({ id: contactsTable.id }).from(contactsTable)).length).toBe(contactsAvant.length);
  });

  it("chaque champ réellement corrigé est verrouillé, et lui seul", async () => {
    const contact = await unContact("verrou");
    const prospect = await unProspect("verrou", contact.id);

    await enregistrer(
      formulaire(prospect.id, { ...IDENTITE_A, nom: `${IDENTITE_A.nom} verrou`, email: "corrigee@example.test" })
    );

    const verrous = await getDb()
      .select()
      .from(champsVerrouillesTable)
      .where(eq(champsVerrouillesTable.contactId, contact.id));
    expect(verrous.map((v) => v.champ)).toEqual(["email"]);
  });

  it("un prospect d'un autre workspace ne peut pas être modifié", async () => {
    const autre = `test-vendeur-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre workspace vendeur" });
    idsWorkspaces.push(autre);
    const prospect = await creerProspectVendeur(
      {
        ...IDENTITE_A,
        nom: "[test réel] Vendeur etranger",
        origineLead: undefined,
        origineLeadDetail: undefined,
        adresseBienPotentiel: undefined,
        secteurBienPotentiel: undefined,
        ville: undefined,
        codePostal: undefined,
        typeBien: undefined,
      },
      autre
    );
    idsProspects.push(prospect.id);

    // L'action tourne avec le workspace `default` : la ligne n'est pas dans son périmètre, donc
    // aucune ligne ne correspond et l'action rend notFound() plutôt que d'écrire.
    await expect(modifierProspectVendeurAction(formulaire(prospect.id))).rejects.toThrow();
    expect((await ligneProspect(prospect.id)).email).toBe(IDENTITE_A.email);
  });
});

describe("ADR-057 — UN contact, DEUX rôles", () => {
  it("modifier depuis le vendeur change aussi ce que voit le parcours acquéreur", async () => {
    // LE test qui justifie le modèle Contact. Le même humain vend un bien et en cherche un autre :
    // sans identité canonique, corriger son numéro d'un côté le laisse faux de l'autre, pour
    // toujours.
    const contact = await unContact("multirole");
    const prospect = await unProspect("multirole", contact.id);
    const dossierAcquereur = await creerAcquereur(
      {
        nom: "[test réel] Ancienne identite acquereur",
        prenom: "Ancien",
        email: "legacy-acquereur@example.test",
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
    idsAcquereurs.push(dossierAcquereur.id);

    await enregistrer(formulaire(prospect.id));

    // Les deux rôles convergent sur la même personne.
    expect((await getProspectVendeurById(prospect.id))?.email).toBe(IDENTITE_D.email);
    expect((await getClientById(dossierAcquereur.id))?.email).toBe(IDENTITE_D.email);
    expect((await getClientById(dossierAcquereur.id))?.nom).toBe(IDENTITE_D.nom);

    // Et AUCUN des deux dossiers legacy n'a été réécrit : ils restent leurs instantanés respectifs.
    expect((await ligneProspect(prospect.id)).email).toBe(IDENTITE_A.email);
    const [ligneAcquereur] = await getDb()
      .select()
      .from(acquereursTable)
      .where(eq(acquereursTable.id, dossierAcquereur.id));
    expect(ligneAcquereur!.email).toBe("legacy-acquereur@example.test");
  });
});

describe("ADR-057 vendeur — communications", () => {
  it("le destinataire est l'email du Contact pour un prospect rattaché", async () => {
    const contact = await unContact("gmail");
    const prospect = await unProspect("gmail", contact.id);
    await getDb().update(contactsTable).set({ email: "vendeur-canonique@example.test" }).where(eq(contactsTable.id, contact.id));

    const relu = await getProspectVendeurById(prospect.id);
    expect(versCandidatProspectVendeur(relu!).email).toBe("vendeur-canonique@example.test");
  });

  it("un Contact sans email produit une absence de destinataire, jamais l'ancienne adresse", async () => {
    const contact = await unContact("gmail-nul", { email: undefined });
    const prospect = await unProspect("gmail-nul", contact.id);

    const relu = await getProspectVendeurById(prospect.id);
    expect(versCandidatProspectVendeur(relu!).email).toBeUndefined();
  });
});
