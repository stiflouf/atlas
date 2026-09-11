import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-057 — L'IDENTITÉ CANONIQUE EFFECTIVE, de bout en bout. Ce fichier ne vérifie pas qu'un
// repository sait écrire `contacts` : il ferme la boucle « un conseiller corrige une adresse, et
// l'email part à la bonne ». Avant ce lot, `contacts` était strictement append-only — la correction
// était enregistrée, affichée, et sans aucun effet sur l'identité canonique ni sur le destinataire.
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
  evenementsMetier,
  executionsAutomatisation,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { creerContact, getContactById } = await import("@/lib/contactRepository");
const { versCandidatAcquereur } = await import("@/lib/communications/destinataireCommunication");
const { modifierAcquereurAction } = await import("./modifierAcquereur");

const IDENTITE_A = {
  prenom: "Jean",
  nom: "[test réel] Identite A",
  email: "ancienne@example.test",
  telephone: "0600000000",
};
const IDENTITE_B = {
  prenom: "Jeanne",
  nom: "[test réel] Identite B",
  email: "nouvelle@example.test",
  telephone: "0611111111",
};

const idsAcquereurs: string[] = [];
const idsContacts: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetier.id })
      .from(evenementsMetier)
      .where(inArray(evenementsMetier.acquereurId, idsAcquereurs));
    if (evenements.length > 0) {
      const ids = evenements.map((e) => e.id);
      await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, ids));
      await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, ids));
    }
    await getDb()
      .delete(compatibilitesBienAcquereurEtat)
      .where(inArray(compatibilitesBienAcquereurEtat.acquereurId, idsAcquereurs));
    await getDb()
      .delete(compatibilitesARessynchroniser)
      .where(inArray(compatibilitesARessynchroniser.acquereurId, idsAcquereurs));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  }
  if (idsContacts.length > 0) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsWorkspaces.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
  }
});

function formulaire(id: string, identite = IDENTITE_B): FormData {
  const formData = new FormData();
  formData.set("id", id);
  formData.set("prenom", identite.prenom);
  formData.set("nom", identite.nom);
  formData.set("email", identite.email);
  formData.set("telephone", identite.telephone);
  formData.set("budgetMin", "100000");
  formData.set("budgetMax", "400000");
  formData.set("criteres", "");
  formData.set("stadeProjet", "recherche_active");
  formData.set("notes", "");
  formData.set("datePremiereContact", "2026-01-01");
  return formData;
}

// `redirect()` lève par conception (Next.js) : l'attraper est la seule façon d'observer l'effet.
const enregistrer = (formData: FormData) => modifierAcquereurAction(formData).catch(() => {});

async function unAcquereurRattache(suffixe: string, surchargeContact: Record<string, unknown> = {}) {
  const contact = await creerContact(
    { nom: IDENTITE_A.nom, prenom: IDENTITE_A.prenom, email: IDENTITE_A.email, telephone: IDENTITE_A.telephone, ...surchargeContact },
    WORKSPACE_TEST
  );
  idsContacts.push(contact.id);
  const dossier = await creerAcquereur(
    {
      ...IDENTITE_A,
      nom: `${IDENTITE_A.nom} ${suffixe}`,
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
  idsAcquereurs.push(dossier.id);
  return { contact, dossier };
}

async function unDossierHistorique(suffixe: string) {
  const dossier = await creerAcquereur(
    {
      ...IDENTITE_A,
      nom: `[test réel] Historique ${suffixe}`,
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function ligneDossier(id: string) {
  const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id));
  return ligne!;
}

describe("ADR-057 — identité effective en LECTURE", () => {
  it("un dossier rattaché rend l'identité du Contact, pas la sienne", async () => {
    const { contact, dossier } = await unAcquereurRattache("lecture");
    await getDb()
      .update(contactsTable)
      .set({ nom: "Dupont", prenom: "Jean", email: "canonique@example.test", telephone: "0655555555" })
      .where(eq(contactsTable.id, contact.id));

    const relu = await getClientById(dossier.id);

    expect(relu?.nom).toBe("Dupont");
    expect(relu?.email).toBe("canonique@example.test");
    expect(relu?.telephone).toBe("0655555555");
  });

  it("un Contact sans email ne récupère JAMAIS celui du dossier", async () => {
    // Le cœur de la règle d'agrégat. Le dossier porte une adresse (colonne NOT NULL), le Contact
    // n'en a pas : l'identité effective n'en a pas non plus. Reprendre celle du dossier ferait
    // repartir un email à une adresse qu'un humain vient peut-être d'effacer.
    const { dossier } = await unAcquereurRattache("email-nul", {
      nom: "Dupont",
      prenom: "Jean",
      email: undefined,
      telephone: undefined,
    });

    const relu = await getClientById(dossier.id);

    expect(relu?.nom).toBe("Dupont");
    expect(relu?.prenom).toBe("Jean");
    expect(relu?.email).toBeUndefined();
    expect(relu?.telephone).toBeUndefined();
    // Et le dossier, lui, porte bien encore l'ancienne valeur — le test ne passe pas par accident.
    expect((await ligneDossier(dossier.id)).email).toBe(IDENTITE_A.email);
  });

  it("un dossier historique garde son identité legacy", async () => {
    const dossier = await unDossierHistorique("lecture");
    const relu = await getClientById(dossier.id);
    expect(relu?.email).toBe(IDENTITE_A.email);
    expect(relu?.telephone).toBe(IDENTITE_A.telephone);
  });

  it("une référence de Contact cassée échoue bruyamment", async () => {
    // La FK `acquereurs.contact_id -> contacts.id` rend l'état impossible à fabriquer par une
    // écriture réelle : Postgres refuse de pointer vers un contact absent comme de supprimer un
    // contact référencé. La garde est donc éprouvée sur un exécuteur qui rend ce que rendrait une
    // base incohérente.
    const { resoudreSourceIdentiteAcquereur } = await import("@/lib/identiteContactEffective");
    const executeurIncoherent = {
      select: () => ({
        from: () => ({
          leftJoin: () => ({
            where: async () => [
              {
                dossierId: "00000000-0000-4000-8000-000000000001",
                contactId: "00000000-0000-4000-8000-0000000000ff",
                contactTrouveId: null,
                nom: null,
                prenom: null,
                email: null,
                telephone: null,
              },
            ],
          }),
        }),
      }),
    };

    await expect(
      resoudreSourceIdentiteAcquereur("00000000-0000-4000-8000-000000000001", executeurIncoherent as never)
    ).rejects.toThrow(/Contact référencé mais introuvable/);
  });
});

describe("ADR-057 — identité effective en ÉCRITURE", () => {
  it("édition humaine -> Contact seul ; le dossier reste l'instantané de création", async () => {
    const { contact, dossier } = await unAcquereurRattache("ecriture");
    const avant = await getContactById(contact.id);

    // `modifie_le` de la ligne créée vient de l'horloge POSTGRES (defaultNow()), celui de l'UPDATE
    // de l'horloge NODE : les comparer directement dépend de la dérive entre les deux (mesurée à
    // plusieurs secondes sous WSL2). On pousse donc l'horloge Node au-delà de la valeur lue, même
    // précédent que clientRepository.test.ts.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(new Date(avant!.modifieLe).getTime() + 1000));

    await enregistrer(formulaire(dossier.id));

    vi.useRealTimers();

    const contactApres = await getContactById(contact.id);
    expect(contactApres?.nom).toBe(IDENTITE_B.nom);
    expect(contactApres?.email).toBe(IDENTITE_B.email);
    expect(contactApres?.telephone).toBe(IDENTITE_B.telephone);
    expect(new Date(contactApres!.modifieLe).getTime()).toBeGreaterThan(new Date(avant!.modifieLe).getTime());

    const legacy = await ligneDossier(dossier.id);
    expect(legacy.email).toBe(IDENTITE_A.email);
    expect(legacy.telephone).toBe(IDENTITE_A.telephone);
    expect(legacy.prenom).toBe(IDENTITE_A.prenom);

    // Le parcours, lui, reste bien porté par le dossier.
    expect(legacy.stadeProjet).toBe("recherche_active");

    // Et ce que le formulaire rechargera est la nouvelle identité, pas l'instantané.
    const relu = await getClientById(dossier.id);
    expect(relu?.email).toBe(IDENTITE_B.email);
  });

  it("chaque champ d'identité réellement corrigé est verrouillé, et lui seul", async () => {
    const { contact, dossier } = await unAcquereurRattache("verrou");

    // Seule l'adresse change : nom, prénom et téléphone sont réenregistrés à l'identique.
    await enregistrer(formulaire(dossier.id, { ...IDENTITE_A, email: "corrigee@example.test" }));

    const verrous = await getDb()
      .select()
      .from(champsVerrouillesTable)
      .where(eq(champsVerrouillesTable.contactId, contact.id));
    expect(verrous.map((v) => v.champ)).toEqual(["email"]);
    expect(verrous[0]!.workspaceId).toBe(WORKSPACE_TEST);
  });

  it("un dossier historique écrit son identité en legacy, sans créer de Contact", async () => {
    const dossier = await unDossierHistorique("ecriture");
    const contactsAvant = await getDb().select({ id: contactsTable.id }).from(contactsTable);

    await enregistrer(formulaire(dossier.id));

    const legacy = await ligneDossier(dossier.id);
    expect(legacy.email).toBe(IDENTITE_B.email);
    expect(legacy.nom).toBe(IDENTITE_B.nom);
    expect(legacy.contactId).toBeNull();
    expect((await getDb().select({ id: contactsTable.id }).from(contactsTable)).length).toBe(contactsAvant.length);
  });

  it("le Contact d'un autre workspace est refusé", async () => {
    const autre = `test-identite-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre workspace" });
    idsWorkspaces.push(autre);
    const contactEtranger = await creerContact({ nom: "[test réel] Etranger" }, autre);
    idsContacts.push(contactEtranger.id);

    const { modifierIdentiteContact } = await import("@/lib/contactRepository");
    await expect(
      modifierIdentiteContact(contactEtranger.id, { nom: "Pirate" }, WORKSPACE_TEST)
    ).rejects.toThrow(/autre workspace/);

    // Et rien n'a bougé.
    expect((await getContactById(contactEtranger.id))?.nom).toBe("[test réel] Etranger");
  });
});

describe("ADR-057 — communications", () => {
  it("le destinataire Gmail est l'email du CONTACT pour un dossier rattaché", async () => {
    // Le test qui justifie le lot : avant, le message partait à `ancienne@example.test` alors que
    // le conseiller avait corrigé l'adresse.
    const { contact, dossier } = await unAcquereurRattache("gmail");
    await getDb()
      .update(contactsTable)
      .set({ email: "nouvelle@example.test" })
      .where(eq(contactsTable.id, contact.id));

    const acquereur = await getClientById(dossier.id);
    const candidat = versCandidatAcquereur(acquereur!);

    expect(candidat.email).toBe("nouvelle@example.test");
    expect(candidat.email).not.toBe(IDENTITE_A.email);
  });

  it("un Contact sans email produit une absence de destinataire, jamais l'ancienne adresse", async () => {
    const { dossier } = await unAcquereurRattache("gmail-nul", { email: undefined });

    const acquereur = await getClientById(dossier.id);
    const candidat = versCandidatAcquereur(acquereur!);

    expect(candidat.email).toBeUndefined();
  });

  it("un dossier historique continue d'utiliser son email legacy", async () => {
    const dossier = await unDossierHistorique("gmail");
    const acquereur = await getClientById(dossier.id);
    expect(versCandidatAcquereur(acquereur!).email).toBe(IDENTITE_A.email);
  });
});
