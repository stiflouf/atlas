import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Contact } from "@/types/contact";

// CRM_TIMELINE_V1 — `enregistrerEchangeManuel` : UNE interaction canonique par échange noté à la
// main (stratégie B, jamais le journal legacy), workspace explicite, contact actif sous verrou,
// contexte validé contre les liens réels du contact, `dernier_contact_le` avancé (monotone) sur
// les prospects vendeurs ACTIFS du contact — sauf note interne. Intégration Postgres réelle.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  mandats: mandatsTable,
  partiesMandat: partiesMandatTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("./contactRepository");
const { creerBien } = await import("./bienRepository");
const { creerMandat } = await import("./mandatRepository");
const { ajouterPartieMandat } = await import("./partieMandatRepository");
const { creerProjetAcquereur } = await import("./projetAcquereurRepository");
const { creerProjetVendeur } = await import("./projetVendeurRepository");
const { ajouterPartieProjet } = await import("./partieProjetRepository");
const { creerProspectVendeur } = await import("./prospectVendeurRepository");
const { fusionnerContacts } = await import("./fusionContactRepository");
const { enregistrerEchangeManuel, TYPES_ECHANGE_CONTACT_HUMAIN } = await import("./interactionRepository");

const M = `Zechange${Date.now()}`;
const WORKSPACE_B = `ws-echange-b-${Date.now()}`;
let compteur = 0;
const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsProspects: string[] = [];
const idsBiens: string[] = [];
const idsMandats: string[] = [];
let workspaceBCree = false;

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.contactId, idsContacts));
  }
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsMandats.length > 0) await getDb().delete(mandatsTable).where(inArray(mandatsTable.id, idsMandats));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsContacts.length > 0) {
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0) await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0) await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function workspaceB() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] échange manuel B" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

async function unContact(nom: string, workspaceId = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} ${nom}` }, workspaceId);
  idsContacts.push(contact.id);
  return contact;
}

async function unProspect(contactId: string, surcharge: { dernierContactLe?: Date; datePerte?: string; archiveLe?: Date } = {}, workspaceId = WORKSPACE_TEST) {
  const prospect = await creerProspectVendeur({ nom: `${M} Prospect`, contactId }, workspaceId);
  idsProspects.push(prospect.id);
  if (Object.keys(surcharge).length > 0) {
    await getDb().update(prospectsVendeursTable).set(surcharge).where(eq(prospectsVendeursTable.id, prospect.id));
  }
  return prospect;
}

async function dernierContact(prospectId: string): Promise<string | null> {
  const [ligne] = await getDb().select({ d: prospectsVendeursTable.dernierContactLe }).from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospectId));
  return ligne.d ? ligne.d.toISOString() : null;
}

async function unProjetVendeur(contactId: string, workspaceId = WORKSPACE_TEST) {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, workspaceId);
  idsProjetsV.push(projet.id);
  await ajouterPartieProjet({ contactId, projetVendeurId: projet.id, role: "vendeur" });
  return projet;
}

async function unProjetAcquereur(contactId: string, workspaceId = WORKSPACE_TEST) {
  const projet = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active" }, workspaceId);
  idsProjetsA.push(projet.id);
  await ajouterPartieProjet({ contactId, projetAcquereurId: projet.id, role: "acquereur" });
  return projet;
}

async function unBien(workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `${M}-BIEN-${compteur}`,
      titre: "Maison de l'échange",
      type: "maison",
      adresse: "2 rue du Journal",
      ville: "Testville",
      codePostal: "00000",
      surface: 90,
      pieces: 4,
      prix: 400000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function absorber(absorbe: Contact, survivant: Contact) {
  const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });
  const resultat = await fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: identite(survivant),
    identiteAttendueAbsorbe: identite(absorbe),
    identiteFinale: { nom: survivant.nom, prenom: survivant.prenom, email: survivant.email, telephone: survivant.telephone },
    choixParChamp: { nom: "survivant", prenom: "identique", email: "identique", telephone: "identique" },
    acteur: { sub: "test" },
  });
  if (resultat.statut !== "fusionne") throw new Error(`fusion attendue, reçu ${resultat.statut}`);
}

const echange = (contactId: string, surcharge: Partial<Parameters<typeof enregistrerEchangeManuel>[0]> = {}) => ({
  contactId,
  type: "appel" as const,
  sens: "sortant" as const,
  survenuLe: "2026-09-10T09:00:00.000Z",
  contenu: "Point téléphonique",
  ...surcharge,
});

describe("enregistrerEchangeManuel — writer canonique (intégration Postgres)", () => {
  it("A. écrit une interaction canonique complète : type, sens, date métier, contenu, sans contexte", async () => {
    const contact = await unContact("A nominal");
    const resultat = await enregistrerEchangeManuel(echange(contact.id), WORKSPACE_TEST);
    expect(resultat.statut).toBe("enregistre");
    if (resultat.statut !== "enregistre") return;
    expect(resultat.interaction.contactId).toBe(contact.id);
    expect(resultat.interaction.type).toBe("appel");
    expect(resultat.interaction.sens).toBe("sortant");
    expect(resultat.interaction.survenuLe).toBe("2026-09-10T09:00:00.000Z");
    expect(resultat.interaction.contenu).toBe("Point téléphonique");
    expect(resultat.interaction.projetVendeurId).toBeUndefined();
    expect(resultat.interaction.bienId).toBeUndefined();
    expect(resultat.prospectsMisAJour).toBe(0);
  });

  it("B. refuse un contact d'un autre workspace (contact_introuvable), sans rien écrire", async () => {
    const contact = await unContact("B ailleurs", await workspaceB());
    const resultat = await enregistrerEchangeManuel(echange(contact.id), WORKSPACE_TEST);
    expect(resultat).toEqual({ statut: "contact_introuvable" });
    expect(await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contact.id))).toEqual([]);
  });

  it("C. refuse un contact absorbé (contact_fusionne) : jamais réécrit vers le survivant (ADR-059 §10)", async () => {
    const survivant = await unContact("C survivant");
    const absorbe = await unContact("C absorbé");
    await absorber(absorbe, survivant);
    const resultat = await enregistrerEchangeManuel(echange(absorbe.id), WORKSPACE_TEST);
    expect(resultat).toEqual({ statut: "contact_fusionne" });
    expect(await getDb().select().from(interactionsTable).where(inArray(interactionsTable.contactId, [absorbe.id, survivant.id]))).toEqual([]);
  });

  it("D. accepte les contextes réellement reliés au contact : projet vendeur, projet acquéreur, bien (mandat ou prospect)", async () => {
    const contact = await unContact("D contextes");
    const projetV = await unProjetVendeur(contact.id);
    const projetA = await unProjetAcquereur(contact.id);
    const bienMandat = await unBien();
    const mandat = await creerMandat({ bienId: bienMandat.id, dateDebut: "2026-01-01", type: "exclusif" });
    idsMandats.push(mandat.id);
    expect((await ajouterPartieMandat(mandat.id, { contactId: contact.id, role: "mandant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
    const bienProspect = await unBien();
    const prospect = await unProspect(contact.id);
    await getDb().update(prospectsVendeursTable).set({ bienId: bienProspect.id }).where(eq(prospectsVendeursTable.id, prospect.id));

    const rV = await enregistrerEchangeManuel(echange(contact.id, { contexte: { kind: "projetVendeur", id: projetV.id } }), WORKSPACE_TEST);
    const rA = await enregistrerEchangeManuel(echange(contact.id, { contexte: { kind: "projetAcquereur", id: projetA.id } }), WORKSPACE_TEST);
    const rBM = await enregistrerEchangeManuel(echange(contact.id, { contexte: { kind: "bien", id: bienMandat.id } }), WORKSPACE_TEST);
    const rBP = await enregistrerEchangeManuel(echange(contact.id, { contexte: { kind: "bien", id: bienProspect.id } }), WORKSPACE_TEST);
    expect(rV.statut === "enregistre" && rV.interaction.projetVendeurId).toBe(projetV.id);
    expect(rA.statut === "enregistre" && rA.interaction.projetAcquereurId).toBe(projetA.id);
    expect(rBM.statut === "enregistre" && rBM.interaction.bienId).toBe(bienMandat.id);
    expect(rBP.statut === "enregistre" && rBP.interaction.bienId).toBe(bienProspect.id);
  });

  it("E. refuse un contexte non relié au contact, ou relié à un contact d'un autre workspace (contexte_invalide)", async () => {
    const contact = await unContact("E contexte");
    const autre = await unContact("E autre");
    const projetDAutre = await unProjetVendeur(autre.id);
    const bienSansLien = await unBien();
    const contactB = await unContact("E contact B", await workspaceB());
    const projetB = await unProjetVendeur(contactB.id, WORKSPACE_B);

    for (const contexte of [
      { kind: "projetVendeur" as const, id: projetDAutre.id },
      { kind: "bien" as const, id: bienSansLien.id },
      { kind: "projetVendeur" as const, id: projetB.id },
      { kind: "projetAcquereur" as const, id: "00000000-0000-4000-8000-000000000000" },
    ]) {
      expect(await enregistrerEchangeManuel(echange(contact.id, { contexte }), WORKSPACE_TEST), contexte.kind).toEqual({ statut: "contexte_invalide" });
    }
    // Même le vrai propriétaire du projet B ne peut pas l'atteindre depuis le workspace A.
    expect(await enregistrerEchangeManuel(echange(contactB.id, { contexte: { kind: "projetVendeur", id: projetB.id } }), WORKSPACE_TEST)).toEqual({ statut: "contact_introuvable" });
    expect(await getDb().select().from(interactionsTable).where(inArray(interactionsTable.contactId, [contact.id, contactB.id]))).toEqual([]);
  });

  it("F. un appel sortant avance dernier_contact_le des prospects vendeurs ACTIFS du contact, dans le même geste", async () => {
    const contact = await unContact("F dernier contact");
    const actifSansDate = await unProspect(contact.id);
    const actifAncien = await unProspect(contact.id, { dernierContactLe: new Date("2026-01-01T00:00:00.000Z") });
    const perdu = await unProspect(contact.id, { datePerte: "2026-05-01", dernierContactLe: new Date("2026-01-01T00:00:00.000Z") });
    const archive = await unProspect(contact.id, { archiveLe: new Date("2026-05-01T00:00:00.000Z") });
    const dUnAutre = await unProspect((await unContact("F autre")).id);

    const resultat = await enregistrerEchangeManuel(echange(contact.id, { survenuLe: "2026-09-10T09:00:00.000Z" }), WORKSPACE_TEST);
    expect(resultat.statut === "enregistre" && resultat.prospectsMisAJour).toBe(2);
    expect(await dernierContact(actifSansDate.id)).toBe("2026-09-10T09:00:00.000Z");
    expect(await dernierContact(actifAncien.id)).toBe("2026-09-10T09:00:00.000Z");
    expect(await dernierContact(perdu.id)).toBe("2026-01-01T00:00:00.000Z");
    expect(await dernierContact(archive.id)).toBeNull();
    expect(await dernierContact(dUnAutre.id)).toBeNull();
  });

  it("G. une note interne n'avance jamais dernier_contact_le ; les cinq types d'échange humain le font", async () => {
    const contact = await unContact("G note interne");
    const prospect = await unProspect(contact.id, { dernierContactLe: new Date("2026-01-01T00:00:00.000Z") });
    const note = await enregistrerEchangeManuel(echange(contact.id, { type: "note", sens: "interne", survenuLe: "2026-09-11T09:00:00.000Z" }), WORKSPACE_TEST);
    expect(note.statut === "enregistre" && note.prospectsMisAJour).toBe(0);
    expect(await dernierContact(prospect.id)).toBe("2026-01-01T00:00:00.000Z");
    expect(TYPES_ECHANGE_CONTACT_HUMAIN).toEqual(["appel", "email", "sms", "rendez_vous", "message"]);
    expect(TYPES_ECHANGE_CONTACT_HUMAIN).not.toContain("note");
    const rdv = await enregistrerEchangeManuel(echange(contact.id, { type: "rendez_vous", sens: undefined, survenuLe: "2026-09-12T09:00:00.000Z" }), WORKSPACE_TEST);
    expect(rdv.statut === "enregistre" && rdv.prospectsMisAJour).toBe(1);
    expect(await dernierContact(prospect.id)).toBe("2026-09-12T09:00:00.000Z");
  });

  it("H. antidaté : dernier_contact_le est MONOTONE (MAX), un échange plus ancien ne le recule pas", async () => {
    const contact = await unContact("H antidaté");
    const prospect = await unProspect(contact.id, { dernierContactLe: new Date("2026-08-01T00:00:00.000Z") });
    const resultat = await enregistrerEchangeManuel(echange(contact.id, { survenuLe: "2026-03-15T10:00:00.000Z" }), WORKSPACE_TEST);
    expect(resultat.statut).toBe("enregistre");
    expect(await dernierContact(prospect.id)).toBe("2026-08-01T00:00:00.000Z");
    // L'interaction, elle, garde SA date métier : le fait est enregistré, seul l'indicateur reste au plus récent.
    const [ligne] = await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contact.id));
    expect(ligne.survenuLe.toISOString()).toBe("2026-03-15T10:00:00.000Z");
  });

  it("I. transaction : un contexte invalide ne laisse aucune interaction ni mise à jour de prospect", async () => {
    const contact = await unContact("I atomique");
    const prospect = await unProspect(contact.id);
    const resultat = await enregistrerEchangeManuel(echange(contact.id, { contexte: { kind: "bien", id: "00000000-0000-4000-8000-000000000000" } }), WORKSPACE_TEST);
    expect(resultat).toEqual({ statut: "contexte_invalide" });
    expect(await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, contact.id))).toEqual([]);
    expect(await dernierContact(prospect.id)).toBeNull();
  });
});
