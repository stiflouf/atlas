import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { ChoixFusionParChamp, IdentiteContactSnapshot } from "@/types/contactFusion";
import type { Contact } from "@/types/contact";

// ADR-059 — LE MOTEUR : absorbé → survivant en une transaction, ou rien. Ces tests décrivent chaque
// refus (self, périmètre, déjà fusionné, identité changée, choix incohérent, contradiction de
// références non acquittée), chaque repoint (parties dédoublées AVANT, interactions, dossiers,
// références), ce qui ne bouge jamais (instantanés legacy, verrous de l'absorbé), le journal, le
// rollback intégral, et la concurrence sur un même absorbé.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

// Injection d'échec pour le test de rollback : le marqueur échoue APRÈS tous les repoints.
const { echecMarqueur } = vi.hoisted(() => ({ echecMarqueur: { actif: false } }));
vi.mock("@/lib/contactRepository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contactRepository")>();
  return {
    ...original,
    marquerContactFusionne: (...args: Parameters<typeof original.marquerContactFusionne>) => {
      if (echecMarqueur.actif) throw new Error("échec simulé du marqueur");
      return original.marquerContactFusionne(...args);
    },
  };
});

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact, getContactDuWorkspace } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerReferenceExterne } = await import("@/lib/provenance/referenceExterneRepository");
const { verrouillerChamp } = await import("@/lib/provenance/champVerrouilleRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const { chargerContactDetail } = await import("@/lib/contactDetailRepository");
const { rechercherContacts } = await import("@/lib/rechercheContactRepository");
const { trouverContactsSimilaires } = await import("@/lib/similariteContactRepository");
const { rechercherContactsCandidats } = await import("@/lib/rattachementContact");

const M = `Zmoteur${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.contactId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
  }
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0)
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: null, fusionneLe: null })
      .where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0)
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (idsWorkspaces.length > 0)
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string } = {},
  workspace = WORKSPACE_TEST
) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjetAcquereur() {
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 300_000, criteres: [], stadeProjet: "recherche_active" },
    WORKSPACE_TEST
  );
  idsProjetsA.push(projet.id);
  return projet;
}

async function unProjetVendeur() {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  return projet;
}

async function unDossierAcquereur(contactId: string, suffixe: string) {
  const dossier = await creerAcquereur(
    {
      prenom: "Legacy",
      nom: `${M} Dossier ${suffixe}`,
      email: `${M}.legacy.${suffixe}@example.test`,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      contactId,
    },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unDossierVendeur(contactId: string, suffixe: string) {
  const prospect = await creerProspectVendeur(
    {
      nom: `${M} Prospect ${suffixe}`,
      prenom: "Legacy",
      email: `${M}.prospect.${suffixe}@example.test`,
      telephone: "0700000000",
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

async function unWorkspace(suffixe: string) {
  const id = `${M}-${suffixe}`;
  await getDb().insert(workspacesTable).values({ id, nom: `[test réel] ${suffixe}` });
  idsWorkspaces.push(id);
  return id;
}

const attendue = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });

// Choix « le survivant garde tout » : la forme la plus simple d'une identité finale cohérente.
function toutSurvivant(s: Contact, a: Contact): { identiteFinale: IdentiteContactSnapshot; choixParChamp: ChoixFusionParChamp } {
  const choix = (champ: "nom" | "prenom" | "email" | "telephone") => {
    if (s[champ] === a[champ]) return "identique" as const;
    if (s[champ] === undefined || a[champ] === undefined) return "absence_comblee" as const;
    return "survivant" as const;
  };
  return {
    identiteFinale: {
      nom: s.nom,
      prenom: s.prenom ?? a.prenom,
      email: s.email ?? a.email,
      telephone: s.telephone ?? a.telephone,
    },
    choixParChamp: { nom: choix("nom"), prenom: choix("prenom"), email: choix("email"), telephone: choix("telephone") },
  };
}

const ACTEUR = { sub: "sub-test", email: "conseiller@example.test" };

async function fusionner(
  survivant: Contact,
  absorbe: Contact,
  surcharge: Partial<Parameters<typeof fusionnerContacts>[0]> = {},
  workspaceId = WORKSPACE_TEST
) {
  return fusionnerContacts({
    workspaceId,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: attendue(survivant),
    identiteAttendueAbsorbe: attendue(absorbe),
    ...toutSurvivant(survivant, absorbe),
    acteur: ACTEUR,
    ...surcharge,
  });
}

async function ligne(id: string) {
  const [l] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, id));
  return l!;
}

async function journaux(absorbeId: string) {
  return getDb().select().from(contactFusionsTable).where(eq(contactFusionsTable.contactAbsorbeId, absorbeId));
}

async function partiesDe(contactId: string) {
  return getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.contactId, contactId)).orderBy(asc(partiesProjetTable.creeLe));
}

describe("fusionnerContacts — refus, sans aucune écriture", () => {
  it("A. self merge : meme_contact, aucun journal", async () => {
    const a = await unContact({ nom: `${M} Self` });
    expect(await fusionner(a, a)).toEqual({ statut: "meme_contact" });
    expect(await journaux(a.id)).toEqual([]);
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
  });

  it("B. autre workspace : contact_introuvable, sans révéler lequel existe ailleurs", async () => {
    const autre = await unWorkspace("ws-b");
    const s = await unContact({ nom: `${M} Ici` });
    const a = await unContact({ nom: `${M} Ailleurs` }, autre);
    expect(await fusionner(s, a)).toEqual({ statut: "contact_introuvable" });
    expect(await fusionner(a, s)).toEqual({ statut: "contact_introuvable" });
    expect(await fusionner(s, a, {}, autre)).toEqual({ statut: "contact_introuvable" });
    expect(await fusionner(s, { ...a, id: "00000000-0000-4000-8000-000000000000" })).toEqual({ statut: "contact_introuvable" });
    expect(await fusionner(s, { ...a, id: "pas-un-uuid" })).toEqual({ statut: "contact_introuvable" });
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
    expect((await ligne(s.id)).fusionneDansContactId).toBeNull();
  });

  it("C/D. survivant ou absorbé déjà fusionné : deja_fusionne", async () => {
    const c = await unContact({ nom: `${M} Actif C` });
    const b = await unContact({ nom: `${M} Absorbé B` });
    const a = await unContact({ nom: `${M} Actif A` });
    expect((await fusionner(c, b)).statut).toBe("fusionne");
    // C. survivant absorbé : B ne peut pas absorber A.
    expect(await fusionner(await getContactDuWorkspace(b.id, WORKSPACE_TEST) as Contact, a)).toEqual({ statut: "deja_fusionne" });
    // D. absorbé déjà absorbé : A ne peut pas absorber B.
    expect(await fusionner(a, await getContactDuWorkspace(b.id, WORKSPACE_TEST) as Contact)).toEqual({ statut: "deja_fusionne" });
    expect((await journaux(b.id)).length).toBe(1);
    expect((await ligne(b.id)).fusionneDansContactId).toBe(c.id);
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
  });

  it("E. identité du survivant changée depuis l'affichage : identite_modifiee_entre_temps", async () => {
    const s = await unContact({ nom: `${M} S ancien` });
    const a = await unContact({ nom: `${M} A` });
    const perime = { ...attendue(s), nom: `${M} S tel qu'affiché` };
    expect(await fusionner(s, a, { identiteAttendueSurvivant: perime })).toEqual({ statut: "identite_modifiee_entre_temps" });
    expect(await fusionner(s, a, { identiteAttendueSurvivant: { ...attendue(s), modifieLe: "2020-01-01T00:00:00.000Z" } })).toEqual({
      statut: "identite_modifiee_entre_temps",
    });
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
    expect(await journaux(a.id)).toEqual([]);
  });

  it("F. identité de l'absorbé changée depuis l'affichage : identite_modifiee_entre_temps", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A`, email: unEmail() });
    expect(await fusionner(s, a, { identiteAttendueAbsorbe: { ...attendue(a), email: "autre@example.test" } })).toEqual({
      statut: "identite_modifiee_entre_temps",
    });
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
  });

  it("G. choix incohérent avec l'identité finale : choix_identite_invalide, champ nommé", async () => {
    const s = await unContact({ nom: `${M} S`, email: unEmail() });
    const a = await unContact({ nom: `${M} A`, email: unEmail() });
    const base = toutSurvivant(s, a);
    // choix email = absorbe mais valeur finale = email du survivant.
    expect(
      await fusionner(s, a, { choixParChamp: { ...base.choixParChamp, email: "absorbe" } })
    ).toEqual({ statut: "choix_identite_invalide", champ: "email" });
    // « identique » alors que les deux emails diffèrent.
    expect(
      await fusionner(s, a, { choixParChamp: { ...base.choixParChamp, email: "identique" } })
    ).toEqual({ statut: "choix_identite_invalide", champ: "email" });
    // « absence_comblee » alors que les deux sont renseignés.
    expect(
      await fusionner(s, a, { choixParChamp: { ...base.choixParChamp, email: "absence_comblee" } })
    ).toEqual({ statut: "choix_identite_invalide", champ: "email" });
    // valeur inventée par personne.
    expect(
      await fusionner(s, a, { identiteFinale: { ...base.identiteFinale, email: "invente@example.test" } })
    ).toEqual({ statut: "choix_identite_invalide", champ: "email" });
    // chaîne arbitraire à la place d'un choix typé.
    expect(
      await fusionner(s, a, { choixParChamp: { ...base.choixParChamp, nom: "plus_recent" as never } })
    ).toEqual({ statut: "choix_identite_invalide", champ: "nom" });
    // nom vide.
    expect(
      await fusionner(s, a, { identiteFinale: { ...base.identiteFinale, nom: "  " } })
    ).toEqual({ statut: "choix_identite_invalide", champ: "nom" });
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
    expect(await journaux(a.id)).toEqual([]);
  });
});

describe("fusionnerContacts — parties de projet", () => {
  it("H. projets distincts : le survivant participe aux deux", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const p1 = await unProjetAcquereur();
    const p2 = await unProjetAcquereur();
    await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: p1.id, role: "acquereur" });
    await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p2.id, role: "acquereur" });

    const resultat = await fusionner(s, a);
    expect(resultat.statut).toBe("fusionne");
    const parties = await partiesDe(s.id);
    expect(parties.map((p) => p.projetAcquereurId).sort()).toEqual([p1.id, p2.id].sort());
    expect(await partiesDe(a.id)).toEqual([]);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.partiesProjet).toHaveLength(1);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.partiesProjetSupprimees).toEqual([]);
  });

  it("I. projet commun, même rôle : une seule partie, celle du survivant, supprimée AVANT le repoint", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const p = await unProjetAcquereur();
    const partieS = await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: p.id, role: "acquereur" });
    const partieA = await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p.id, role: "acquereur" });

    const resultat = await fusionner(s, a);
    expect(resultat.statut).toBe("fusionne");
    const parties = await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.projetAcquereurId, p.id));
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ id: partieS.id, contactId: s.id, role: "acquereur" });
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.partiesProjetSupprimees).toEqual([partieA.id]);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.partiesProjet).toEqual([]);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.partiesProjetRoleCorrige).toEqual([]);
  });

  it("J. projet acquéreur commun, rôles différents : le rôle principal est préservé sur la partie conservée", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const p = await unProjetAcquereur();
    const partieS = await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: p.id, role: "co_acquereur" });
    const partieA = await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p.id, role: "acquereur" });

    const resultat = await fusionner(s, a);
    expect(resultat.statut).toBe("fusionne");
    const parties = await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.projetAcquereurId, p.id));
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ id: partieS.id, contactId: s.id, role: "acquereur" });
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces).toMatchObject({
      partiesProjetSupprimees: [partieA.id],
      partiesProjetRoleCorrige: [{ partieId: partieS.id, roleAvant: "co_acquereur", roleFinal: "acquereur" }],
    });
  });

  it("J'. projet commun, survivant principal et absorbé secondaire : rôle inchangé, partie absorbée supprimée", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const p = await unProjetAcquereur();
    await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: p.id, role: "acquereur" });
    const partieA = await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p.id, role: "co_acquereur" });
    const resultat = await fusionner(s, a);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces).toMatchObject({
      partiesProjetSupprimees: [partieA.id],
      partiesProjetRoleCorrige: [],
    });
    expect((await partiesDe(s.id))[0]?.role).toBe("acquereur");
  });

  it("K. projet vendeur commun, rôles différents : vendeur > co_vendeur", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const p = await unProjetVendeur();
    const partieS = await ajouterPartieProjet({ contactId: s.id, projetVendeurId: p.id, role: "co_vendeur" });
    const partieA = await ajouterPartieProjet({ contactId: a.id, projetVendeurId: p.id, role: "vendeur" });
    const resultat = await fusionner(s, a);
    const parties = await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.projetVendeurId, p.id));
    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({ id: partieS.id, contactId: s.id, role: "vendeur" });
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.partiesProjetSupprimees).toEqual([partieA.id]);
  });

  it("L. multi-rôle : survivant acquéreur + absorbé vendeur → survivant porte les deux, aucun projet fusionné", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const pa = await unProjetAcquereur();
    const pv = await unProjetVendeur();
    await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: pa.id, role: "acquereur" });
    await ajouterPartieProjet({ contactId: a.id, projetVendeurId: pv.id, role: "vendeur" });
    expect((await fusionner(s, a)).statut).toBe("fusionne");
    const detail = await chargerContactDetail(s.id, WORKSPACE_TEST);
    expect(detail?.type === "actif" && detail.detail.roles).toEqual(["acquereur", "vendeur"]);
    expect(detail?.type === "actif" && detail.detail.projetsAcquereur.map((p) => p.projetId)).toEqual([pa.id]);
    expect(detail?.type === "actif" && detail.detail.projetsVendeur.map((p) => p.projetId)).toEqual([pv.id]);
  });
});

describe("fusionnerContacts — dépendances repointées, instantanés intacts", () => {
  it("M. interactions : toutes sur le survivant, dates, types, sens et contextes inchangés", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const p = await unProjetAcquereur();
    await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p.id, role: "acquereur" });
    const i1 = await creerInteraction({ contactId: s.id, type: "appel", sens: "entrant", survenuLe: "2026-03-01T10:00:00.000Z" });
    const i2 = await creerInteraction({
      contactId: a.id,
      type: "email",
      sens: "sortant",
      survenuLe: "2026-03-02T10:00:00.000Z",
      projetAcquereurId: p.id,
    });
    const avant = await getDb().select().from(interactionsTable).where(eq(interactionsTable.id, i2.id));

    const resultat = await fusionner(s, a);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.interactions).toEqual([i2.id]);
    const apres = await getDb().select().from(interactionsTable).where(inArray(interactionsTable.id, [i1.id, i2.id]));
    expect(apres.every((i) => i.contactId === s.id)).toBe(true);
    expect(apres.find((i) => i.id === i2.id)).toEqual({ ...avant[0], contactId: s.id });
  });

  it("N/O/P. dossiers acquéreur et vendeur : deux dossiers chacun, tous vers le survivant, instantanés d'identité intacts", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const acqS = await unDossierAcquereur(s.id, "s");
    const acqA = await unDossierAcquereur(a.id, "a");
    const venS = await unDossierVendeur(s.id, "s");
    const venA = await unDossierVendeur(a.id, "a");
    const acqAvant = await getDb().select().from(acquereursTable).where(inArray(acquereursTable.id, [acqS.id, acqA.id]));
    const venAvant = await getDb().select().from(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, [venS.id, venA.id]));

    const resultat = await fusionner(s, a);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces).toMatchObject({ acquereurs: [acqA.id], prospectsVendeurs: [venA.id] });

    const acqApres = await getDb().select().from(acquereursTable).where(inArray(acquereursTable.id, [acqS.id, acqA.id]));
    const venApres = await getDb().select().from(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, [venS.id, venA.id]));
    expect(acqApres).toHaveLength(2);
    expect(venApres).toHaveLength(2);
    for (const d of [...acqApres, ...venApres]) expect(d.contactId).toBe(s.id);
    // Seul contact_id change : tout le reste de la ligne est identique.
    for (const avant of [...acqAvant, ...venAvant]) {
      const apres = [...acqApres, ...venApres].find((d) => d.id === avant.id)!;
      expect(apres).toEqual({ ...avant, contactId: s.id });
    }
  });

  it("Q. références externes sans contradiction : toutes sur le survivant, aucune supprimée", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    const r1 = await enregistrerReferenceExterne(
      { fournisseur: "gmail", typeEntiteExterne: "message", idExterne: `${M}-1`, cible: { type: "contact", id: s.id } },
      WORKSPACE_TEST
    );
    const r2 = await enregistrerReferenceExterne(
      { fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-2`, cible: { type: "contact", id: a.id } },
      WORKSPACE_TEST
    );
    const resultat = await fusionner(s, a);
    expect(resultat.statut === "fusionne" && resultat.idsDeplaces.referencesExternes).toEqual([r2.id]);
    const refs = await getDb().select().from(referencesExternesTable).where(inArray(referencesExternesTable.id, [r1.id, r2.id]));
    expect(refs).toHaveLength(2);
    expect(refs.every((r) => r.contactId === s.id)).toBe(true);
    const [journal] = await journaux(a.id);
    expect(journal.avertissementsAcquittes).toEqual([]);
  });

  it("R/S. références contradictoires : refus factuel sans acquittement, fusion avec, les deux conservées", async () => {
    const s = await unContact({ nom: `${M} S` });
    const a = await unContact({ nom: `${M} A` });
    await enregistrerReferenceExterne(
      { fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-111`, cible: { type: "contact", id: s.id } },
      WORKSPACE_TEST
    );
    await enregistrerReferenceExterne(
      { fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-222`, cible: { type: "contact", id: a.id } },
      WORKSPACE_TEST
    );

    const refus = await fusionner(s, a);
    expect(refus).toEqual({
      statut: "avertissement_reference_externe_requis",
      avertissements: [
        {
          cle: "reference_externe_contradictoire:playiad/contact",
          type: "reference_externe_contradictoire",
          fournisseur: "playiad",
          typeEntiteExterne: "contact",
          idsExternesSurvivant: [`${M}-111`],
          idsExternesAbsorbe: [`${M}-222`],
        },
      ],
    });
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
    expect(await journaux(a.id)).toEqual([]);

    // Un acquittement qui ne correspond à rien n'est pas un acquittement.
    expect(await fusionner(s, a, { avertissementsAcquittes: ["reference_externe_contradictoire:hektor/contact"] })).toEqual({
      statut: "acquittement_inconnu",
      cles: ["reference_externe_contradictoire:hektor/contact"],
    });

    const succes = await fusionner(s, a, { avertissementsAcquittes: ["reference_externe_contradictoire:playiad/contact"] });
    expect(succes.statut).toBe("fusionne");
    const refs = await getDb().select().from(referencesExternesTable).where(eq(referencesExternesTable.contactId, s.id));
    expect(refs.map((r) => r.idExterne).sort()).toEqual([`${M}-111`, `${M}-222`]);
    const [journal] = await journaux(a.id);
    expect(journal.avertissementsAcquittes).toEqual(["reference_externe_contradictoire:playiad/contact"]);
  });

  it("T. verrous : ceux de l'absorbé restent sur sa ligne ; le survivant ne reçoit que ceux de l'identité finale changée", async () => {
    const s = await unContact({ nom: `${M} S`, email: unEmail() });
    const a = await unContact({ nom: `${M} A`, telephone: "0611111111" });
    await verrouillerChamp({ type: "contact", id: s.id }, "email", WORKSPACE_TEST);
    await verrouillerChamp({ type: "contact", id: a.id }, "telephone", WORKSPACE_TEST);

    // Identité finale : téléphone comblé depuis l'absorbé → un seul champ change sur le survivant.
    const resultat = await fusionner(s, a);
    expect(resultat.statut).toBe("fusionne");
    const verrousS = await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, s.id));
    const verrousA = await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, a.id));
    expect(verrousS.map((v) => v.champ).sort()).toEqual(["email", "telephone"]);
    expect(verrousA.map((v) => v.champ)).toEqual(["telephone"]);
  });
});

describe("fusionnerContacts — résultat, journal, atomicité", () => {
  it("U/V/W. identité finale appliquée, absorbé marqué, survivant actif, journal complet", async () => {
    const s = await unContact({ nom: `${M} Survivant`, prenom: "Sam", email: unEmail() });
    const a = await unContact({ nom: `${M} Absorbé`, prenom: "Ana", email: unEmail(), telephone: "0622222222" });
    const identiteFinale = { nom: a.nom, prenom: s.prenom, email: a.email, telephone: a.telephone };
    const choixParChamp: ChoixFusionParChamp = { nom: "absorbe", prenom: "survivant", email: "absorbe", telephone: "absence_comblee" };

    const resultat = await fusionner(s, a, { identiteFinale, choixParChamp });
    expect(resultat.statut).toBe("fusionne");
    if (resultat.statut !== "fusionne") return;

    const survivant = await ligne(s.id);
    expect(survivant).toMatchObject({ ...identiteFinale, fusionneDansContactId: null, fusionneLe: null });
    expect(survivant.modifieLe.getTime()).toBeGreaterThan(new Date(s.modifieLe).getTime());
    const absorbe = await ligne(a.id);
    expect(absorbe.fusionneDansContactId).toBe(s.id);
    expect(absorbe.fusionneLe).not.toBeNull();
    // L'identité de l'absorbé est figée telle qu'elle était.
    expect(absorbe).toMatchObject({ nom: a.nom, prenom: "Ana", email: a.email, telephone: "0622222222" });

    const lignes = await journaux(a.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      id: resultat.fusionId,
      contactSurvivantId: s.id,
      contactAbsorbeId: a.id,
      fusionneParSub: "sub-test",
      fusionneParEmail: "conseiller@example.test",
      identiteAvantSurvivant: { nom: s.nom, prenom: "Sam", email: s.email },
      identiteAvantAbsorbe: { nom: a.nom, prenom: "Ana", email: a.email, telephone: "0622222222" },
      identiteFinale,
      choixParChamp,
      idsDeplaces: {
        interactions: [],
        partiesProjet: [],
        partiesProjetSupprimees: [],
        partiesProjetRoleCorrige: [],
        acquereurs: [],
        prospectsVendeurs: [],
        referencesExternes: [],
      },
      avertissementsAcquittes: [],
    });
    expect(lignes[0].fusionneLe.getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Verrous humains posés sur les seuls champs réellement changés du survivant.
    const verrous = await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, s.id));
    expect(verrous.map((v) => v.champ).sort()).toEqual(["email", "nom", "telephone"]);
  });

  it("identité finale identique au survivant : aucun verrou, modifie_le inchangé", async () => {
    const s = await unContact({ nom: `${M} S`, email: unEmail() });
    const a = await unContact({ nom: `${M} S`, email: s.email });
    const resultat = await fusionner(s, a, {
      identiteFinale: { nom: s.nom, email: s.email },
      choixParChamp: { nom: "identique", prenom: "identique", email: "identique", telephone: "identique" },
    });
    expect(resultat.statut).toBe("fusionne");
    expect((await ligne(s.id)).modifieLe.toISOString()).toBe(s.modifieLe);
    expect(await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, s.id))).toEqual([]);
  });

  it("X. rollback atomique : un échec après les repoints laisse tout intact, aucun journal", async () => {
    const s = await unContact({ nom: `${M} S`, email: unEmail() });
    const a = await unContact({ nom: `${M} A`, email: unEmail(), telephone: "0633333333" });
    const p = await unProjetAcquereur();
    const partieA = await ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p.id, role: "acquereur" });
    const interaction = await creerInteraction({ contactId: a.id, type: "note", survenuLe: "2026-03-03T10:00:00.000Z" });
    const dossier = await unDossierAcquereur(a.id, "rollback");
    const prospect = await unDossierVendeur(a.id, "rollback");
    const ref = await enregistrerReferenceExterne(
      { fournisseur: "gmail", typeEntiteExterne: "message", idExterne: `${M}-rb`, cible: { type: "contact", id: a.id } },
      WORKSPACE_TEST
    );
    const survivantAvant = await ligne(s.id);

    echecMarqueur.actif = true;
    try {
      await expect(fusionner(s, a)).rejects.toThrow(/échec simulé du marqueur/);
    } finally {
      echecMarqueur.actif = false;
    }

    expect((await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.id, partieA.id)))[0].contactId).toBe(a.id);
    expect((await getDb().select().from(interactionsTable).where(eq(interactionsTable.id, interaction.id)))[0].contactId).toBe(a.id);
    expect((await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, dossier.id)))[0].contactId).toBe(a.id);
    expect((await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, prospect.id)))[0].contactId).toBe(a.id);
    expect((await getDb().select().from(referencesExternesTable).where(eq(referencesExternesTable.id, ref.id)))[0].contactId).toBe(a.id);
    expect(await ligne(s.id)).toEqual(survivantAvant);
    expect((await ligne(a.id)).fusionneDansContactId).toBeNull();
    expect(await journaux(a.id)).toEqual([]);
    expect(await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, s.id))).toEqual([]);
  });

  it("Y. lecteurs après fusion : recherche, similarité, rattachement, fiche — sans nouvelle UI", async () => {
    const email = unEmail();
    const s = await unContact({ nom: `${M} Lecteurs S`, email });
    const a = await unContact({ nom: `${M} Lecteurs A`, email });
    expect((await fusionner(s, a)).statut).toBe("fusionne");

    const recherche = await rechercherContacts({ workspaceId: WORKSPACE_TEST, q: `${M} Lecteurs`, limite: 10 });
    expect(recherche.items.map((i) => i.contactId)).toEqual([s.id]);
    expect(await trouverContactsSimilaires(s.id, WORKSPACE_TEST)).toEqual([]);
    expect(await trouverContactsSimilaires(a.id, WORKSPACE_TEST)).toBeUndefined();
    expect((await rechercherContactsCandidats(`${M} Lecteurs`, WORKSPACE_TEST)).map((c) => c.id)).toEqual([s.id]);
    expect(await chargerContactDetail(a.id, WORKSPACE_TEST)).toMatchObject({ type: "fusionne", contactActifId: s.id });
    expect((await chargerContactDetail(s.id, WORKSPACE_TEST))?.type).toBe("actif");
  });

  it("Z. concurrence : deux fusions du même absorbé — une seule réussit, l'autre voit deja_fusionne", async () => {
    const s1 = await unContact({ nom: `${M} Concurrent 1` });
    const s2 = await unContact({ nom: `${M} Concurrent 2` });
    const a = await unContact({ nom: `${M} Concurrent absorbé` });
    const [r1, r2] = await Promise.all([fusionner(s1, a), fusionner(s2, a)]);
    const statuts = [r1.statut, r2.statut].sort();
    expect(statuts).toEqual(["deja_fusionne", "fusionne"]);
    expect(await journaux(a.id)).toHaveLength(1);
    const absorbe = await ligne(a.id);
    expect([s1.id, s2.id]).toContain(absorbe.fusionneDansContactId);
  });

  it("verrou croisé : A absorbe B pendant que B absorbe A — une seule fusion, jamais d'interblocage", async () => {
    const a = await unContact({ nom: `${M} Croisé A` });
    const b = await unContact({ nom: `${M} Croisé B` });
    const [r1, r2] = await Promise.all([fusionner(a, b), fusionner(b, a)]);
    expect([r1.statut, r2.statut].sort()).toEqual(["deja_fusionne", "fusionne"]);
    const lignes = await getDb().select().from(contactsTable).where(inArray(contactsTable.id, [a.id, b.id]));
    expect(lignes.filter((l) => l.fusionneDansContactId !== null)).toHaveLength(1);
  });
});
