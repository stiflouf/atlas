import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { ETAT_FORMULAIRE_INITIAL } from "@/lib/formulaires/etatFormulaire";

// ADR-055 — COEXISTENCE : les créations réelles alimentent désormais l'identité canonique, sans
// que rien du comportement historique ne change. Ces tests vérifient les deux moitiés de cette
// phrase, parce que c'est la seule chose qui rend la fondation utile ET sûre.
//
// Session et workspace mockés comme dans tous les tests de Server Actions (ADR-047/054) : ce qui
// est testé ici est le pont Contact, pas la garde d'authentification (couverte structurellement).
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  acquereurs: acquereursTable,
  prospectsVendeurs: prospectsVendeursTable,
  compatibilitesARessynchroniser,
  compatibilitesBienAcquereurEtat,
  evenementsMetier,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
} = await import("@/db/schema");
const { creerAcquereurAction } = await import("./creerAcquereur");
const { creerProspectVendeurAction } = await import("./prospectVendeur");
const { getContactById } = await import("@/lib/contactRepository");

const MARQUEUR = "[test réel] CONTACT-COEXISTENCE";
const EMAIL_PARTAGE = "foyer.coexistence@example.test";

afterAll(async () => {
  const acquereurs = await getDb().select().from(acquereursTable).where(like(acquereursTable.nom, `%${MARQUEUR}%`));
  const ids = acquereurs.map((a) => a.id);
  if (ids.length > 0) {
    await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.acquereurId, ids));
    await getDb().delete(compatibilitesBienAcquereurEtat).where(inArray(compatibilitesBienAcquereurEtat.acquereurId, ids));
    await getDb().delete(compatibilitesARessynchroniser).where(inArray(compatibilitesARessynchroniser.acquereurId, ids));
  }
  await getDb().delete(acquereursTable).where(like(acquereursTable.nom, `%${MARQUEUR}%`));
  await getDb().delete(prospectsVendeursTable).where(like(prospectsVendeursTable.nom, `%${MARQUEUR}%`));

  // ADR-055 §B — une création acquéreur écrit aussi un projet canonique et sa partie. Le nettoyage
  // part des CONTACTS et non des acquéreurs : un `acquereurs` déjà supprimé (ou une exécution
  // précédente interrompue) laisserait sinon des parties orphelines qui bloquent la suppression des
  // contacts par la FK parties_projet -> contacts.
  const contactsMarques = await getDb()
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(like(contactsTable.nom, `%${MARQUEUR}%`));
  const idsContacts = contactsMarques.map((contact) => contact.id);
  if (idsContacts.length > 0) {
    const parties = await getDb()
      .select({
        projetAcquereurId: partiesProjetTable.projetAcquereurId,
        projetVendeurId: partiesProjetTable.projetVendeurId,
      })
      .from(partiesProjetTable)
      .where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));

    const idsAcquereur = [
      ...new Set(parties.map((partie) => partie.projetAcquereurId).filter((id): id is string => id !== null)),
    ];
    if (idsAcquereur.length > 0) {
      await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsAcquereur));
    }
    const idsVendeur = [
      ...new Set(parties.map((partie) => partie.projetVendeurId).filter((id): id is string => id !== null)),
    ];
    if (idsVendeur.length > 0) {
      await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsVendeur));
    }
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

function formulaireAcquereur(nom: string, email: string): FormData {
  const formData = new FormData();
  formData.set("prenom", "Camille");
  formData.set("nom", nom);
  formData.set("email", email);
  formData.set("telephone", "0611111111");
  formData.set("budgetMin", "100000");
  formData.set("budgetMax", "400000");
  formData.set("criteres", "");
  formData.set("stadeProjet", "decouverte");
  formData.set("notes", "");
  formData.set("datePremiereContact", "2026-01-01");
  return formData;
}

function formulaireProspect(nom: string): FormData {
  const formData = new FormData();
  formData.set("nom", nom);
  formData.set("prenom", "Dominique");
  formData.set("email", EMAIL_PARTAGE);
  formData.set("telephone", "0622222222");
  return formData;
}

describe("ADR-055 — coexistence du modèle historique et de l'identité canonique", () => {
  it("créer un acquéreur crée aussi son Contact canonique, et les relie", async () => {
    const nom = `${MARQUEUR} ACQUEREUR`;
    await creerAcquereurAction(ETAT_FORMULAIRE_INITIAL, formulaireAcquereur(nom, EMAIL_PARTAGE)).catch(() => {}); // redirect() attendu

    // Comportement historique intact : l'acquéreur existe avec exactement les champs soumis.
    const [acquereur] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.nom, nom));
    expect(acquereur).toBeDefined();
    expect(acquereur.email).toBe(EMAIL_PARTAGE);
    expect(acquereur.prenom).toBe("Camille");

    // Et l'identité canonique existe, rattachée.
    expect(acquereur.contactId).not.toBeNull();
    const contact = await getContactById(acquereur.contactId!);
    expect(contact).toBeDefined();
    expect(contact!.nom).toBe(nom);
    expect(contact!.prenom).toBe("Camille");
    expect(contact!.email).toBe(EMAIL_PARTAGE);
    expect(contact!.telephone).toBe("0611111111");
  });

  it("créer un prospect vendeur crée aussi son Contact canonique, et les relie", async () => {
    const nom = `${MARQUEUR} PROSPECT`;
    await creerProspectVendeurAction(ETAT_FORMULAIRE_INITIAL, formulaireProspect(nom)).catch(() => {}); // redirect() attendu

    const [prospect] = await getDb()
      .select()
      .from(prospectsVendeursTable)
      .where(eq(prospectsVendeursTable.nom, nom));
    expect(prospect).toBeDefined();
    expect(prospect.email).toBe(EMAIL_PARTAGE);

    expect(prospect.contactId).not.toBeNull();
    const contact = await getContactById(prospect.contactId!);
    expect(contact!.nom).toBe(nom);
    expect(contact!.telephone).toBe("0622222222");
  });

  it("deux dossiers partageant un email produisent DEUX contacts distincts — aucune fusion silencieuse", async () => {
    // L'invariant central d'ADR-055 §H. Les deux tests précédents ont créé un acquéreur et un
    // prospect avec le MÊME email : ils ne doivent en aucun cas avoir été rapprochés.
    const [acquereur] = await getDb()
      .select()
      .from(acquereursTable)
      .where(eq(acquereursTable.nom, `${MARQUEUR} ACQUEREUR`));
    const [prospect] = await getDb()
      .select()
      .from(prospectsVendeursTable)
      .where(eq(prospectsVendeursTable.nom, `${MARQUEUR} PROSPECT`));

    expect(acquereur.contactId).not.toBe(prospect.contactId);

    // Rapprocher ces deux personnes est peut-être juste — mais c'est une décision humaine, pas une
    // déduction du produit : deux saisies partageant un email peuvent être un couple.
    const contacts = await getDb().select().from(contactsTable).where(eq(contactsTable.email, EMAIL_PARTAGE));
    expect(contacts.length).toBeGreaterThanOrEqual(2);
  });

  it("les lignes historiques restent non rattachées : aucun backfill n'a été fait", async () => {
    // Les dossiers créés avant ce lot gardent contact_id NULL, et c'est l'état attendu. Un backfill
    // « 1 ligne = 1 contact » aurait fabriqué des doublons structurels.
    const [{ contactId }] = await getDb()
      .insert(acquereursTable)
      .values({
        workspaceId: "default",
        prenom: "Historique",
        nom: `${MARQUEUR} HISTORIQUE`,
        email: "historique@example.test",
        telephone: "0633333333",
        budgetMin: 0,
        budgetMax: 100000,
        criteres: [],
        stadeProjet: "decouverte",
        notes: "",
        datePremiereContact: "2026-01-01",
      })
      .returning({ contactId: acquereursTable.contactId });

    expect(contactId).toBeNull();
  });
});
