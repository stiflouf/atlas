import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-059 — depuis un dossier historique, « Voir le contact » ouvre le Contact ACTIF final :
// direct, absorbé → survivant, chaîne → dernier maillon ; aucun bouton sans rattachement ; jamais
// un lien vers un absorbé ; résolution par le repository, dans le workspace du dossier, sans
// aucune écriture ; identité affichée et destination du lien convergent après une vraie fusion.

// ADR-054 / ADR-061 — les fiches acquéreur/prospect résolvent le workspace de session (lectures
// Offre/Compromis scoped) ; mocké sur le workspace de test.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: async () => "default",
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur, getClientById, getNavigationContactDeLAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur, getProspectVendeurById, getNavigationContactDuProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const FicheClient = (await import("@/app/clients/[id]/page")).default;
const FicheProspectVendeur = (await import("@/app/prospects-vendeurs/[id]/page")).default;

const M = `Znavdossier${Date.now()}`;
let compteur = 0;
const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(nom: string, workspace = WORKSPACE_TEST, prenom?: string) {
  const contact = await creerContact({ nom: `${M} ${nom}`, prenom, email: `${M}.${++compteur}@example.test` }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unAcquereur(contactId?: string, workspace = WORKSPACE_TEST) {
  const dossier = await creerAcquereur(
    { prenom: "Legacy", nom: `${M} Dossier`, email: `${M}.d${++compteur}@example.test`, telephone: "0600000000", budgetMin: 100_000, budgetMax: 200_000, criteres: [], stadeProjet: "recherche_active", notes: "", datePremiereContact: "2026-01-01", contactId },
    workspace
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unProspect(contactId?: string, workspace = WORKSPACE_TEST) {
  const prospect = await creerProspectVendeur(
    { nom: `${M} Prospect`, prenom: "Legacy", email: `${M}.p${++compteur}@example.test`, telephone: undefined, origineLead: undefined, origineLeadDetail: undefined, adresseBienPotentiel: undefined, secteurBienPotentiel: undefined, ville: undefined, codePostal: undefined, typeBien: undefined, contactId },
    workspace
  );
  idsProspects.push(prospect.id);
  return prospect;
}

// État posé directement : un absorbé « à l'ancienne », sans passer par le moteur (qui repointerait
// le dossier) — c'est le cas exceptionnel « dossier → absorbé » que la navigation doit résoudre.
async function absorberEnBase(absorbeId: string, survivantId: string) {
  await getDb().update(contactsTable).set({ fusionneDansContactId: survivantId, fusionneLe: new Date() }).where(eq(contactsTable.id, absorbeId));
}

const rendreBuyer = async (id: string) =>
  renderToStaticMarkup(await FicheClient({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const rendreSeller = async (id: string) =>
  renderToStaticMarkup(await FicheProspectVendeur({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));

const lienContact = (html: string) => [...html.matchAll(/<a[^>]*href="\/contacts\/([0-9a-f-]+)"[^>]*>[^<]*Voir le contact/g)].map((m) => m[1]);

describe("getNavigationContact* — repositories", () => {
  it("A. dossier sans contact : rien, ni contactId ni contactActifId", async () => {
    const acq = await unAcquereur();
    const pro = await unProspect();
    expect(await getNavigationContactDeLAcquereur(acq.id)).toEqual({});
    expect(await getNavigationContactDuProspectVendeur(pro.id)).toEqual({});
    expect(await getNavigationContactDeLAcquereur("pas-un-uuid")).toEqual({});
    expect(await getNavigationContactDuProspectVendeur("00000000-0000-4000-8000-000000000000")).toEqual({});
  });

  it("B. dossier → contact actif A : A", async () => {
    const a = await unContact("A");
    const acq = await unAcquereur(a.id);
    const pro = await unProspect(a.id);
    expect(await getNavigationContactDeLAcquereur(acq.id)).toEqual({ contactId: a.id, contactActifId: a.id });
    expect(await getNavigationContactDuProspectVendeur(pro.id)).toEqual({ contactId: a.id, contactActifId: a.id });
  });

  it("C. dossier → B absorbé → A : contactId reste B (stocké), contactActifId = A", async () => {
    const a = await unContact("A2");
    const b = await unContact("B2");
    const acq = await unAcquereur(b.id);
    const pro = await unProspect(b.id);
    await absorberEnBase(b.id, a.id);
    expect(await getNavigationContactDeLAcquereur(acq.id)).toEqual({ contactId: b.id, contactActifId: a.id });
    expect(await getNavigationContactDuProspectVendeur(pro.id)).toEqual({ contactId: b.id, contactActifId: a.id });
  });

  it("D. dossier → A, A → B → C : C ; et aucun UPDATE du dossier après lecture", async () => {
    const c = await unContact("C3");
    const b = await unContact("B3");
    const a = await unContact("A3");
    const acq = await unAcquereur(a.id);
    const pro = await unProspect(a.id);
    await absorberEnBase(b.id, c.id);
    await absorberEnBase(a.id, b.id);
    const [acqAvant] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, acq.id));
    const [proAvant] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, pro.id));
    expect(await getNavigationContactDeLAcquereur(acq.id)).toEqual({ contactId: a.id, contactActifId: c.id });
    expect(await getNavigationContactDuProspectVendeur(pro.id)).toEqual({ contactId: a.id, contactActifId: c.id });
    const [acqApres] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, acq.id));
    const [proApres] = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, pro.id));
    expect(acqApres).toEqual(acqAvant);
    expect(proApres).toEqual(proAvant);
    expect(acqApres.contactId).toBe(a.id);
  });

  it("E. la résolution se fait dans le workspace du dossier : un maillon d'un autre workspace = chaîne invalide, jamais un lien", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre navigation" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact("Ailleurs", autre);
    const b = await unContact("B5");
    const acq = await unAcquereur(b.id);
    // Corruption simulée : B pointe un contact d'un autre workspace.
    await absorberEnBase(b.id, ailleurs.id);
    await expect(getNavigationContactDeLAcquereur(acq.id)).rejects.toThrow(/Contact canonique incohérent.*chaine_invalide/);
  });

  it("F. chaîne invalide (cycle) : erreur contrôlée, jamais un href fabriqué", async () => {
    const a = await unContact("A6");
    const b = await unContact("B6");
    const acq = await unAcquereur(a.id);
    const pro = await unProspect(a.id);
    await absorberEnBase(a.id, b.id);
    await absorberEnBase(b.id, a.id);
    await expect(getNavigationContactDeLAcquereur(acq.id)).rejects.toThrow(/Contact canonique incohérent pour le dossier acquéreur/);
    await expect(getNavigationContactDuProspectVendeur(pro.id)).rejects.toThrow(/Contact canonique incohérent pour le dossier vendeur/);
  });

  it("nombre de requêtes borné : 2 pour un contact actif, 2 + maillons pour une chaîne", async () => {
    const c = await unContact("C7");
    const b = await unContact("B7");
    const a = await unContact("A7");
    const direct = await unAcquereur(c.id);
    const enChaine = await unAcquereur(a.id);
    await absorberEnBase(b.id, c.id);
    await absorberEnBase(a.id, b.id);
    const compter = async (id: string) => {
      const db = getDb();
      const espion = vi.spyOn(db, "select");
      await getNavigationContactDeLAcquereur(id, db);
      const n = espion.mock.calls.length;
      espion.mockRestore();
      return n;
    };
    expect(await compter(direct.id)).toBe(2);
    expect(await compter(enChaine.id)).toBe(4);
  });
});

// Premier rendu des deux pages Server Component : compilation à froid, bien au-delà des 5 s par défaut.
describe("pages /clients/[id] et /prospects-vendeurs/[id] — « Voir le contact »", { timeout: 30_000 }, () => {
  it("contact actif : lien vers A ; autres actions conservées", async () => {
    const a = await unContact("Page A", WORKSPACE_TEST, "Alice");
    const acq = await unAcquereur(a.id);
    const pro = await unProspect(a.id);
    const buyer = await rendreBuyer(acq.id);
    expect(lienContact(buyer)).toEqual([a.id]);
    expect(buyer).toContain(`/clients/${acq.id}/modifier`);
    expect(buyer).toContain(`/taches/nouveau?acquereurId=${acq.id}`);
    const seller = await rendreSeller(pro.id);
    expect(lienContact(seller)).toEqual([a.id]);
    expect(seller).toContain(`/prospects-vendeurs/${pro.id}/modifier`);
  });

  it("contact absorbé : lien vers le survivant final, jamais vers l'absorbé", async () => {
    const a = await unContact("Page A2", WORKSPACE_TEST, "Alice");
    const b = await unContact("Page B2", WORKSPACE_TEST, "Bob");
    const acq = await unAcquereur(b.id);
    const pro = await unProspect(b.id);
    await absorberEnBase(b.id, a.id);
    const buyer = await rendreBuyer(acq.id);
    expect(lienContact(buyer)).toEqual([a.id]);
    expect(buyer).not.toContain(`href="/contacts/${b.id}"`);
    const seller = await rendreSeller(pro.id);
    expect(lienContact(seller)).toEqual([a.id]);
    expect(seller).not.toContain(`href="/contacts/${b.id}"`);
  });

  it("dossier non rattaché : aucun « Voir le contact », section de rattachement inchangée", async () => {
    const acq = await unAcquereur();
    const pro = await unProspect();
    const buyer = await rendreBuyer(acq.id);
    expect(buyer).not.toContain("Voir le contact");
    expect(buyer).toContain("Identité non rattachée");
    const seller = await rendreSeller(pro.id);
    expect(seller).not.toContain("Voir le contact");
    expect(seller).toContain("Identité non rattachée");
  });
});

describe("intégration post-fusion réelle — identité et navigation convergent", { timeout: 30_000 }, () => {
  it("fusion B → A par le moteur : dossiers historiques de B affichent A et mènent à A", async () => {
    const a = await unContact("Survivant", WORKSPACE_TEST, "Alice");
    const b = await unContact("Absorbé", WORKSPACE_TEST, "Bob");
    const acq = await unAcquereur(b.id);
    const pro = await unProspect(b.id);
    const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });
    const resultat = await fusionnerContacts({
      workspaceId: WORKSPACE_TEST,
      contactSurvivantId: a.id,
      contactAbsorbeId: b.id,
      identiteAttendueSurvivant: identite(a),
      identiteAttendueAbsorbe: identite(b),
      identiteFinale: { nom: a.nom, prenom: "Alice", email: a.email },
      choixParChamp: { nom: "survivant", prenom: "survivant", email: "survivant", telephone: "identique" },
      acteur: { sub: "test" },
    });
    expect(resultat.statut).toBe("fusionne");

    const buyerDomaine = await getClientById(acq.id);
    expect(buyerDomaine).toMatchObject({ nom: a.nom, prenom: "Alice", email: a.email });
    expect(await getNavigationContactDeLAcquereur(acq.id)).toEqual({ contactId: a.id, contactActifId: a.id });
    const sellerDomaine = await getProspectVendeurById(pro.id);
    expect(sellerDomaine).toMatchObject({ nom: a.nom, prenom: "Alice", email: a.email });
    expect(await getNavigationContactDuProspectVendeur(pro.id)).toEqual({ contactId: a.id, contactActifId: a.id });

    const buyer = await rendreBuyer(acq.id);
    expect(buyer).toContain(`Alice ${a.nom}`);
    expect(lienContact(buyer)).toEqual([a.id]);
    const seller = await rendreSeller(pro.id);
    expect(seller).toContain(`Alice ${a.nom}`);
    expect(lienContact(seller)).toEqual([a.id]);
    expect(buyer + seller).not.toContain(b.id);
  });
});
