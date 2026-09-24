import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";

// ADR-055 §G — COEXISTENCE. Ce lot ne branche AUCUN flux existant sur les interactions : ni les
// notes vendeur, ni les envois d'email n'en créent. Ces tests le prouvent, et prouvent surtout que
// les workflows historiques continuent de fonctionner exactement comme avant.
//
// Ce n'est pas un lot inachevé : une note vendeur A déjà un foyer (`notes_prospect_vendeur`, dont
// le `type` pilote `dernier_contact_le`, ADR-027 §4), et `envois_email` n'a ni contact ni contenu —
// seulement un hash et un état d'appel réseau. Un miroir y serait FABRIQUÉ, pas constaté, et
// produirait exactement les doublons qu'un futur connecteur Gmail rendrait indémêlables.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  interactions: interactionsTable,
  notesProspectVendeur: notesProspectVendeurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("./contactRepository");
const { creerProjetVendeur } = await import("./projetVendeurRepository");
const { creerProspectVendeur, getProspectVendeurById } = await import("./prospectVendeurRepository");
const { ajouterNoteProspectVendeur } = await import("./noteProspectVendeurRepository");
const { creerInteraction, listerInteractionsDuContact } = await import("./interactionRepository");

const MARQUEUR = "[test réel] INTERACTION-COEXISTENCE";
const idsProspects: string[] = [];
const idsContacts: string[] = [];
const idsProjets: string[] = [];

afterAll(async () => {
  if (idsProspects.length > 0) {
    await getDb()
      .delete(notesProspectVendeurTable)
      .where(inArray(notesProspectVendeurTable.prospectVendeurId, idsProspects));
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  if (idsContacts.length > 0) {
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
  }
  if (idsProjets.length > 0) {
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjets));
  }
  await getDb().delete(contactsTable).where(like(contactsTable.nom, `%${MARQUEUR}%`));
});

describe("ADR-055 §G — les workflows historiques restent indépendants du modèle canonique", () => {
  it("ajouter une note vendeur ne crée AUCUNE interaction, et fait toujours avancer dernier_contact_le", async () => {
    const contact = await creerContact({ nom: `${MARQUEUR} VENDEUR` }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const projet = await creerProjetVendeur({ origineLead: "recommandation" }, WORKSPACE_TEST);
    idsProjets.push(projet.id);
    const prospect = await creerProspectVendeur(
      { nom: `${MARQUEUR} VENDEUR`, contactId: contact.id, projetVendeurId: projet.id },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);
    expect(prospect.dernierContactLe).toBeUndefined();

    const note = await ajouterNoteProspectVendeur(prospect.id, "appel", "Rappelé pour l'estimation.", WORKSPACE_TEST);

    // Comportement historique STRICTEMENT inchangé : la note existe, avec son type, et
    // l'invariant d'ADR-027 §4 s'applique toujours.
    expect(note).toBeDefined();
    expect(note!.type).toBe("appel");
    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.dernierContactLe, "une vraie interaction fait avancer dernier_contact_le").toBeDefined();

    // Et AUCUNE interaction canonique n'a été créée : la note a déjà son foyer.
    expect(await listerInteractionsDuContact(contact.id)).toEqual([]);
  });

  it("une note interne ne fait toujours pas avancer dernier_contact_le, et ne crée rien non plus", async () => {
    const contact = await creerContact({ nom: `${MARQUEUR} INTERNE` }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const prospect = await creerProspectVendeur(
      { nom: `${MARQUEUR} INTERNE`, contactId: contact.id },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);

    await ajouterNoteProspectVendeur(prospect.id, "note_interne", "Penser à vérifier le DPE.", WORKSPACE_TEST);

    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.dernierContactLe, "une note interne n'est pas un contact").toBeUndefined();
    expect(await listerInteractionsDuContact(contact.id)).toEqual([]);
  });

  it("les deux modèles cohabitent sans se voir : une interaction n'altère aucun jalon historique", async () => {
    // Le sens inverse : écrire dans le modèle canonique ne touche rien de l'historique.
    const contact = await creerContact({ nom: `${MARQUEUR} PARALLELE` }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const prospect = await creerProspectVendeur(
      { nom: `${MARQUEUR} PARALLELE`, contactId: contact.id },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);

    await creerInteraction({
      contactId: contact.id,
      type: "appel",
      sens: "sortant",
      survenuLe: "2026-05-04T10:00:00.000Z",
    });

    const relu = await getProspectVendeurById(prospect.id);
    expect(relu!.dernierContactLe, "le modèle canonique ne pilote encore aucun invariant").toBeUndefined();
    expect(await listerInteractionsDuContact(contact.id)).toHaveLength(1);

    // Et la note vendeur historique n'existe pas pour autant.
    const notes = await getDb()
      .select()
      .from(notesProspectVendeurTable)
      .where(eq(notesProspectVendeurTable.prospectVendeurId, prospect.id));
    expect(notes).toEqual([]);
  });

  it("aucune interaction n'existe pour l'historique : aucun backfill n'a été fait", async () => {
    // Convertir les notes, emails et comptes rendus historiques fabriquerait les doublons qu'un
    // futur connecteur Gmail ne saurait pas rapprocher, faute de provenance.
    const [{ total }] = await getDb()
      .select({ total: interactionsTable.id })
      .from(interactionsTable)
      .innerJoin(contactsTable, eq(interactionsTable.contactId, contactsTable.id))
      .where(like(contactsTable.nom, `${MARQUEUR} VENDEUR`))
      .limit(1)
      .then((lignes) => (lignes.length > 0 ? lignes : [{ total: null }]));
    expect(total).toBeNull();
  });
});
