import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// VISIT_NATIVE_ENTRY_V1 — sous-lot MANDATE_PARTIES_AUTOFILL_V1 : signer le mandat d'un prospect
// vendeur porteur d'un Contact canonique pose, DANS la transaction de signature, une partie
// `mandant` sur le mandat créé (résolution automatique du vendeur pour le retour vendeur).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  contacts: contactsTable,
  contactFusions: contactFusionsTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  mandats: mandatsTable,
  partiesMandat: partiesMandatTable,
  prospectsVendeurs: prospectsVendeursTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const { listerPartiesMandat } = await import("@/lib/partieMandatRepository");
const { creerProspectVendeur, signerMandatProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { vendeursCanoniquesDuBien } = await import("@/lib/retourVendeurVisiteRepository");

const M = `[test réel] MANDANT-AUTO ${Date.now()}`;
let compteur = 0;
const idsProspects: string[] = [];
const idsContacts: string[] = [];

afterAll(async () => {
  if (idsProspects.length > 0) {
    const evenements = await getDb()
      .select({ id: evenementsMetierTable.id })
      .from(evenementsMetierTable)
      .where(inArray(evenementsMetierTable.prospectVendeurId, idsProspects));
    const idsEvenements = evenements.map((e) => e.id);
    if (idsEvenements.length > 0) {
      await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, idsEvenements));
      await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, idsEvenements));
    }
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  const biens = await getDb().select({ id: biensTable.id }).from(biensTable).where(eq(biensTable.titre, M));
  const idsBiens = biens.map((b) => b.id);
  if (idsBiens.length > 0) {
    const mandats = await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    const idsMandats = mandats.map((m) => m.id);
    // parties_mandat référence mandats en NO ACTION : parties avant mandats.
    if (idsMandats.length > 0) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, idsMandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unContact(nom: string) {
  const contact = await creerContact({ nom, prenom: "Vendeur" }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

async function unProspect(contactId?: string) {
  const prospect = await creerProspectVendeur({ nom: `${M} ${++compteur}`, contactId }, WORKSPACE_TEST);
  idsProspects.push(prospect.id);
  return prospect;
}

function donneesBien(reference: string) {
  return {
    reference,
    titre: M,
    type: "appartement" as const,
    adresse: "1 rue du Test",
    ville: "Testville",
    codePostal: "00000",
    surface: 50,
    pieces: 2,
    prix: 250000,
    statutMandat: "actif" as const,
    dateMandat: "2026-03-01",
    caracteristiques: [],
    description: "",
  };
}

const FAITS = { type: "simple" as const };

async function signer(prospectId: string, reference: string) {
  const resultat = await signerMandatProspectVendeur(prospectId, donneesBien(reference), WORKSPACE_TEST, FAITS);
  if (resultat.statut !== "signe") throw new Error(`signature attendue, reçu ${resultat.statut}`);
  return resultat;
}

const attendue = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });

describe("signerMandatProspectVendeur — partie mandant automatique", () => {
  it("prospect avec Contact canonique : une partie mandant sur le mandat créé, dans la même transaction", async () => {
    const contact = await unContact(`${M} Mandant`);
    const prospect = await unProspect(contact.id);

    const { mandat, partieMandant } = await signer(prospect.id, `${M}-MANDANT-1`);

    expect(partieMandant).toMatchObject({ mandatId: mandat.id, contactId: contact.id, role: "mandant" });
    const parties = await listerPartiesMandat(mandat.id, WORKSPACE_TEST);
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ contactId: contact.id, role: "mandant" });
  });

  it("le vendeur canonique du bien est résolu sans ajout manuel de partie", async () => {
    const contact = await unContact(`${M} Resolu`);
    const prospect = await unProspect(contact.id);

    const { bien } = await signer(prospect.id, `${M}-MANDANT-2`);

    expect(await vendeursCanoniquesDuBien(bien.id, WORKSPACE_TEST)).toEqual([
      { contactId: contact.id, nom: contact.nom, prenom: contact.prenom },
    ]);
  });

  it("idempotence : une seconde signature ne crée ni second mandat ni seconde partie", async () => {
    const contact = await unContact(`${M} Idem`);
    const prospect = await unProspect(contact.id);

    const { mandat } = await signer(prospect.id, `${M}-MANDANT-3`);
    const seconde = await signerMandatProspectVendeur(prospect.id, donneesBien(`${M}-MANDANT-3bis`), WORKSPACE_TEST, FAITS);

    expect(seconde.statut).toBe("deja_signe");
    const parties = await getDb().select().from(partiesMandatTable).where(eq(partiesMandatTable.contactId, contact.id));
    expect(parties).toHaveLength(1);
    expect(parties[0].mandatId).toBe(mandat.id);
  });

  it("Contact fusionné avant signature : la partie vise le survivant (pont déjà repointé), jamais l'absorbé", async () => {
    const survivant = await unContact(`${M} Survivant`);
    const absorbe = await unContact(`${M} Absorbe`);
    const prospect = await unProspect(absorbe.id);

    const fusion = await fusionnerContacts({
      workspaceId: WORKSPACE_TEST,
      contactSurvivantId: survivant.id,
      contactAbsorbeId: absorbe.id,
      identiteAttendueSurvivant: attendue(survivant),
      identiteAttendueAbsorbe: attendue(absorbe),
      identiteFinale: { nom: survivant.nom, prenom: survivant.prenom },
      choixParChamp: { nom: "survivant", prenom: "identique", email: "identique", telephone: "identique" },
      acteur: { sub: "sub-test", email: "conseiller@example.test" },
    });
    if (fusion.statut !== "fusionne") throw new Error(`fusion attendue, reçu ${fusion.statut}`);

    const { mandat, partieMandant } = await signer(prospect.id, `${M}-MANDANT-4`);

    expect(partieMandant?.contactId).toBe(survivant.id);
    const parties = await listerPartiesMandat(mandat.id, WORKSPACE_TEST);
    expect(parties.map((p) => p.contactId)).toEqual([survivant.id]);
  });

  it("prospect legacy sans Contact : mandat créé sans partie, comportement inchangé", async () => {
    const prospect = await unProspect();

    const { mandat, partieMandant } = await signer(prospect.id, `${M}-MANDANT-5`);

    expect(partieMandant).toBeUndefined();
    expect(await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).toEqual([]);
  });
});
