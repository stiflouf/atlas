import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ADR-055 §G + ADR-056 — le fait canonique produit par un envoi Gmail réussi, contre une vraie
// base. Aucun appel Google n'est mocké ici : ce module n'en fait aucun. Il reçoit un identifiant
// de message déjà obtenu, ce qui est précisément ce qui le rend testable sans réseau.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  prospectsVendeurs: prospectsVendeursTable,
  referencesExternes: referencesExternesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { listerInteractionsDuContact } = await import("@/lib/interactionRepository");
const { finaliserEnvoiGmailReussi } = await import("./finaliserEnvoiGmail");

const contactsCrees: string[] = [];
const acquereursCrees: string[] = [];
const prospectsCrees: string[] = [];
let compteur = 0;

function unMessageId() {
  compteur += 1;
  return `gmail-msg-${compteur}-${Date.now()}`;
}

async function unContact() {
  const contact = await creerContact({ nom: `[test réel] Destinataire ${++compteur}` }, WORKSPACE_TEST);
  contactsCrees.push(contact.id);
  return contact;
}

// Acquéreur créé APRÈS ADR-055 : la ligne historique porte le pont vers l'identité canonique.
async function unAcquereurRattache() {
  const contact = await unContact();
  const acquereur = await creerAcquereur(
    {
      prenom: "Julien",
      nom: "[test réel] Acquéreur Gmail",
      email: "test-reel-gmail@example.com",
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-15",
      contactId: contact.id,
    },
    WORKSPACE_TEST
  );
  acquereursCrees.push(acquereur.id);
  return { acquereur, contact };
}

// Acquéreur HISTORIQUE : aucun contact canonique, comme toutes les lignes antérieures.
async function unAcquereurNonRattache() {
  const acquereur = await creerAcquereur(
    {
      prenom: "Marc",
      nom: "[test réel] Acquéreur historique",
      email: "test-reel-historique@example.com",
      telephone: "0600000001",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-15",
    },
    WORKSPACE_TEST
  );
  acquereursCrees.push(acquereur.id);
  return acquereur;
}

async function unProspectRattache() {
  const contact = await unContact();
  const prospect = await creerProspectVendeur(
    { nom: "[test réel] Prospect Gmail", contactId: contact.id },
    WORKSPACE_TEST
  );
  prospectsCrees.push(prospect.id);
  return { prospect, contact };
}

afterAll(async () => {
  if (contactsCrees.length > 0) {
    const interactions = await getDb()
      .select({ id: interactionsTable.id })
      .from(interactionsTable)
      .where(inArray(interactionsTable.contactId, contactsCrees));
    const idsInteractions = interactions.map((ligne) => ligne.id);
    if (idsInteractions.length > 0) {
      await getDb()
        .delete(referencesExternesTable)
        .where(inArray(referencesExternesTable.interactionId, idsInteractions));
    }
  }
  for (const id of acquereursCrees) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of prospectsCrees) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  if (contactsCrees.length > 0) {
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, contactsCrees));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
});

describe("Envoi Gmail réussi — le fait relationnel canonique", () => {
  it("un acquéreur rattaché reçoit une interaction email sortante datée du succès", async () => {
    const { acquereur, contact } = await unAcquereurRattache();
    const gmailMessageId = unMessageId();
    const survenuLe = "2026-09-10T08:30:00.000Z";

    const resultat = await finaliserEnvoiGmailReussi({
      gmailMessageId,
      survenuLe,
      destinataire: { type: "acquereur", id: acquereur.id },
      workspaceId: WORKSPACE_TEST,
    });

    expect(resultat.statut).toBe("interaction_creee");
    const interactions = await listerInteractionsDuContact(contact.id);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ type: "email", sens: "sortant", contactId: contact.id });
    expect(interactions[0].survenuLe).toBe(new Date(survenuLe).toISOString());
    // Ni contenu, ni contexte métier : l'interaction n'affirme que ce qui est durablement vrai.
    expect(interactions[0].contenu).toBeUndefined();
    expect(interactions[0].projetAcquereurId).toBeUndefined();
    expect(interactions[0].projetVendeurId).toBeUndefined();
    expect(interactions[0].bienId).toBeUndefined();
  });

  it("l'identité Gmail du message désigne exactement cette interaction", async () => {
    const { acquereur } = await unAcquereurRattache();
    const gmailMessageId = unMessageId();

    const resultat = await finaliserEnvoiGmailReussi({
      gmailMessageId,
      survenuLe: "2026-09-10T08:30:00.000Z",
      destinataire: { type: "acquereur", id: acquereur.id },
      workspaceId: WORKSPACE_TEST,
    });
    if (resultat.statut !== "interaction_creee") throw new Error("statut inattendu");

    const [reference] = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(reference).toMatchObject({
      fournisseur: "gmail",
      typeEntiteExterne: "message",
      // L'identifiant BRUT de Google, sans préfixe inventé.
      idExterne: gmailMessageId,
      interactionId: resultat.interactionId,
      workspaceId: WORKSPACE_TEST,
    });
    // Exactement une cible : les cinq autres colonnes restent nulles.
    expect(reference.contactId).toBeNull();
    expect(reference.projetAcquereurId).toBeNull();
    expect(reference.bienId).toBeNull();
  });

  it("un prospect vendeur rattaché produit le même fait", async () => {
    const { prospect, contact } = await unProspectRattache();

    const resultat = await finaliserEnvoiGmailReussi({
      gmailMessageId: unMessageId(),
      survenuLe: "2026-09-10T09:00:00.000Z",
      destinataire: { type: "prospectVendeur", id: prospect.id },
      workspaceId: WORKSPACE_TEST,
    });

    expect(resultat.statut).toBe("interaction_creee");
    const interactions = await listerInteractionsDuContact(contact.id);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ type: "email", sens: "sortant" });
  });
});

describe("Envoi Gmail réussi — ce qui ne produit RIEN", () => {
  it("un destinataire historique sans contact canonique ne produit aucun fait", async () => {
    // L'état de TOUTES les lignes antérieures à ADR-055. Ce n'est pas une erreur : c'est le refus
    // de fabriquer une identité que personne n'a rattachée.
    const acquereur = await unAcquereurNonRattache();
    const gmailMessageId = unMessageId();
    const interactionsAvant = await getDb().select({ id: interactionsTable.id }).from(interactionsTable);

    const resultat = await finaliserEnvoiGmailReussi({
      gmailMessageId,
      survenuLe: "2026-09-10T09:00:00.000Z",
      destinataire: { type: "acquereur", id: acquereur.id },
      workspaceId: WORKSPACE_TEST,
    });

    expect(resultat.statut).toBe("aucun_contact_canonique");
    const interactionsApres = await getDb().select({ id: interactionsTable.id }).from(interactionsTable);
    expect(interactionsApres).toHaveLength(interactionsAvant.length);
    const references = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(references, "aucune identité externe n'est enregistrée sans cible").toEqual([]);
  });

  it("aucun destinataire résolu ne produit aucun fait", async () => {
    // Un email vers une adresse saisie à la main, sans personne structurée derrière. Aucun
    // rapprochement par adresse n'est tenté : ce serait une fusion que personne n'a demandée.
    const gmailMessageId = unMessageId();

    const resultat = await finaliserEnvoiGmailReussi({
      gmailMessageId,
      survenuLe: "2026-09-10T09:00:00.000Z",
      workspaceId: WORKSPACE_TEST,
    });

    expect(resultat.statut).toBe("aucun_contact_canonique");
    const references = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(references).toEqual([]);
  });
});

describe("Envoi Gmail réussi — un message, une interaction", () => {
  it("rejouer la même finalisation ne crée pas de seconde interaction", async () => {
    const { acquereur, contact } = await unAcquereurRattache();
    const entree = {
      gmailMessageId: unMessageId(),
      survenuLe: "2026-09-10T09:00:00.000Z",
      destinataire: { type: "acquereur" as const, id: acquereur.id },
      workspaceId: WORKSPACE_TEST,
    };

    const premier = await finaliserEnvoiGmailReussi(entree);
    const second = await finaliserEnvoiGmailReussi(entree);
    const troisieme = await finaliserEnvoiGmailReussi(entree);

    expect(premier.statut).toBe("interaction_creee");
    expect(second.statut).toBe("deja_ingere");
    expect(troisieme.statut).toBe("deja_ingere");
    if (premier.statut !== "interaction_creee" || second.statut !== "deja_ingere") {
      throw new Error("statuts inattendus");
    }
    // Le rejeu désigne la MÊME interaction, il n'en fabrique pas une jumelle.
    expect(second.interactionId).toBe(premier.interactionId);
    expect(await listerInteractionsDuContact(contact.id)).toHaveLength(1);
  });

  it("deux finalisations CONCURRENTES du même message ne laissent qu'une interaction", async () => {
    // Le cas que la lecture d'idempotence seule ne ferme pas : en READ COMMITTED, aucune des deux
    // transactions ne voit l'insertion non validée de l'autre. C'est la contrainte UNIQUE
    // d'identité externe qui tranche, et la transaction perdante emporte SON interaction —
    // aucune orpheline ne subsiste.
    const { acquereur, contact } = await unAcquereurRattache();
    const entree = {
      gmailMessageId: unMessageId(),
      survenuLe: "2026-09-10T09:00:00.000Z",
      destinataire: { type: "acquereur" as const, id: acquereur.id },
      workspaceId: WORKSPACE_TEST,
    };

    const resultats = await Promise.allSettled([
      finaliserEnvoiGmailReussi(entree),
      finaliserEnvoiGmailReussi(entree),
    ]);

    const interactions = await listerInteractionsDuContact(contact.id);
    expect(interactions, "un message Gmail, une interaction").toHaveLength(1);
    const references = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, entree.gmailMessageId));
    expect(references).toHaveLength(1);
    expect(references[0].interactionId).toBe(interactions[0].id);
    // Au moins une des deux a abouti ; l'autre a soit vu l'identité déjà prise, soit échoué — dans
    // les deux cas elle n'a rien laissé derrière elle.
    expect(resultats.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("le workspace de la référence est celui du contact visé", async () => {
    const { acquereur, contact } = await unAcquereurRattache();
    const gmailMessageId = unMessageId();

    await finaliserEnvoiGmailReussi({
      gmailMessageId,
      survenuLe: "2026-09-10T09:00:00.000Z",
      destinataire: { type: "acquereur", id: acquereur.id },
      workspaceId: WORKSPACE_TEST,
    });

    const [contactEnBase] = await getDb()
      .select({ workspaceId: contactsTable.workspaceId })
      .from(contactsTable)
      .where(eq(contactsTable.id, contact.id));
    const [reference] = await getDb()
      .select({ workspaceId: referencesExternesTable.workspaceId })
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(reference.workspaceId).toBe(contactEnBase.workspaceId);
  });

  it("un workspace qui ne correspond pas au contact est refusé, sans rien laisser", async () => {
    // Le garde-fou d'ADR-054 déjà porté par les repositories : la transaction entière est annulée,
    // donc l'interaction créée juste avant disparaît avec elle.
    const { acquereur, contact } = await unAcquereurRattache();
    const gmailMessageId = unMessageId();

    await expect(
      finaliserEnvoiGmailReussi({
        gmailMessageId,
        survenuLe: "2026-09-10T09:00:00.000Z",
        destinataire: { type: "acquereur", id: acquereur.id },
        workspaceId: "workspace-qui-n-existe-pas",
      })
    ).rejects.toThrow();

    expect(await listerInteractionsDuContact(contact.id), "aucune interaction orpheline").toEqual([]);
    const references = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(references).toEqual([]);
  });
});
