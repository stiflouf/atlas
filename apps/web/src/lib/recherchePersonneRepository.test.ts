import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-058 décision 5 — la recherche MIXTE. Les tests de doctrine : un Contact et un dossier
// historique à la même identité restent DEUX résultats ; un dossier déjà rattaché n'apparaît pas
// deux fois ; rien n'est écrit. Le marqueur isole les lignes de ce fichier dans une base partagée.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { rechercherPersonnes } = await import("@/lib/recherchePersonneRepository");

const M = `Zmixte${Date.now()}`;

const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0)
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0)
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (idsWorkspaces.length > 0)
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(surcharge: Record<string, unknown>, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge } as never, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unAcquereurHistorique(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string; contactId?: string },
  workspace = WORKSPACE_TEST
) {
  const dossier = await creerAcquereur(
    {
      prenom: "Ancien",
      nom: `${M} Acquereur`,
      email: `${M}.acquereur@example.test`,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      ...surcharge,
    },
    workspace
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unProspectHistorique(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string; contactId?: string },
  workspace = WORKSPACE_TEST
) {
  const prospect = await creerProspectVendeur(
    {
      nom: `${M} Vendeur`,
      prenom: undefined,
      email: undefined,
      telephone: undefined,
      origineLead: undefined,
      origineLeadDetail: undefined,
      adresseBienPotentiel: undefined,
      secteurBienPotentiel: undefined,
      ville: undefined,
      codePostal: undefined,
      typeBien: undefined,
      ...surcharge,
    },
    workspace
  );
  idsProspects.push(prospect.id);
  return prospect;
}

const chercher = (q: string, workspace = WORKSPACE_TEST, limite = 100, decalage = 0) =>
  rechercherPersonnes({ workspaceId: workspace, q, limite, decalage });

function cles(items: { type: string; [k: string]: unknown }[]): string[] {
  return items.map((i) =>
    i.type === "contact"
      ? `contact:${i.contactId}`
      : i.type === "legacy_acquereur"
        ? `acquereur:${i.acquereurId}`
        : `vendeur:${i.prospectVendeurId}`
  );
}

describe("rechercherPersonnes — trois sources, une liste", () => {
  it("A. un Contact seul donne un résultat de type contact, avec son contexte canonique", async () => {
    const contact = await unContact({ nom: `${M} Seulcontact` });
    const projet = await creerProjetAcquereur(
      { budgetMin: 200_000, budgetMax: 500_000, criteres: [], stadeProjet: "offre" },
      WORKSPACE_TEST
    );
    idsProjetsA.push(projet.id);
    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projet.id, role: "acquereur" });

    const { items } = await chercher(`${M} Seulcontact`);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "contact", contactId: contact.id, roles: ["acquereur"] });
    expect((items[0] as { projetsAcquereur: unknown[] }).projetsAcquereur).toHaveLength(1);
  });

  it("B. un acquéreur historique non rattaché seul donne un résultat legacy_acquereur", async () => {
    const dossier = await unAcquereurHistorique({ nom: `${M} Seulacquereur`, prenom: "Paul" });

    const { items } = await chercher(`${M} Seulacquereur`);

    expect(items).toEqual([
      {
        type: "legacy_acquereur",
        acquereurId: dossier.id,
        nom: `${M} Seulacquereur`,
        prenom: "Paul",
        email: `${M}.acquereur@example.test`,
        telephone: "0600000000",
      },
    ]);
  });

  it("C. un prospect vendeur historique non rattaché seul donne un résultat legacy_vendeur, sans champ inventé", async () => {
    const prospect = await unProspectHistorique({ nom: `${M} Seulvendeur` });

    const { items } = await chercher(`${M} Seulvendeur`);

    expect(items).toEqual([{ type: "legacy_vendeur", prospectVendeurId: prospect.id, nom: `${M} Seulvendeur` }]);
    expect(items[0]).not.toHaveProperty("contactId");
  });

  it("H. un Contact multi-rôle reste UN résultat dans la recherche mixte", async () => {
    const contact = await unContact({ nom: `${M} Multirole` });
    const projetA = await creerProjetAcquereur(
      { budgetMin: 200_000, budgetMax: 500_000, criteres: [], stadeProjet: "decouverte" },
      WORKSPACE_TEST
    );
    idsProjetsA.push(projetA.id);
    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projetA.id, role: "acquereur" });
    const projetV = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
    idsProjetsV.push(projetV.id);
    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projetV.id, role: "vendeur" });

    const { items } = await chercher(`${M} Multirole`);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "contact", roles: ["acquereur", "vendeur"] });
  });
});

describe("rechercherPersonnes — suggestion n'est pas fusion", () => {
  it("D. un Contact et un dossier historique à la même identité restent DEUX résultats", async () => {
    const email = `${M}.jean@example.test`;
    const contact = await unContact({ nom: `${M} Dupont`, prenom: "Jean", email });
    const dossier = await unAcquereurHistorique({ nom: `${M} Dupont`, prenom: "Jean", email });

    const { items } = await chercher(`Jean ${M} Dupont`);

    expect(cles(items).sort()).toEqual([`acquereur:${dossier.id}`, `contact:${contact.id}`].sort());
  });

  it("E. deux Contacts et un dossier historique au même email : TROIS résultats", async () => {
    const email = `${M}.shared3@example.test`;
    const a = await unContact({ nom: `${M} Shared A`, email });
    const b = await unContact({ nom: `${M} Shared B`, email });
    const c = await unProspectHistorique({ nom: `${M} Shared C`, email });

    const { items } = await chercher(email);

    expect(cles(items).sort()).toEqual([`contact:${a.id}`, `contact:${b.id}`, `vendeur:${c.id}`].sort());
  });

  it("F. deux dossiers historiques au même email restent deux résultats", async () => {
    const email = `${M}.shared2@example.test`;
    const a = await unAcquereurHistorique({ nom: `${M} Legacy A`, email });
    const b = await unProspectHistorique({ nom: `${M} Legacy B`, email });

    const { items } = await chercher(email);

    expect(cles(items).sort()).toEqual([`acquereur:${a.id}`, `vendeur:${b.id}`].sort());
  });

  it("le même téléphone ne regroupe rien non plus", async () => {
    const telephone = `06${M.length}334455`;
    const contact = await unContact({ nom: `${M} Tel contact`, telephone });
    const dossier = await unAcquereurHistorique({ nom: `${M} Tel legacy`, telephone });

    const { items } = await chercher(telephone);

    expect(cles(items).sort()).toEqual([`acquereur:${dossier.id}`, `contact:${contact.id}`].sort());
  });
});

describe("rechercherPersonnes — les dossiers rattachés ne réapparaissent pas", () => {
  it("G. un acquéreur et un prospect déjà rattachés sont exclus des sources historiques", async () => {
    const email = `${M}.rattache@example.test`;
    const contact = await unContact({ nom: `${M} Rattache`, email });
    await unAcquereurHistorique({ nom: `${M} Rattache`, email, contactId: contact.id });
    await unProspectHistorique({ nom: `${M} Rattache`, email, contactId: contact.id });

    const { items } = await chercher(email);

    expect(cles(items)).toEqual([`contact:${contact.id}`]);
  });
});

describe("rechercherPersonnes — ranking, workspace, pagination, requête vide", () => {
  it("J. l'email exact passe devant un « contient », quelle que soit la source", async () => {
    const cible = `${M}.exact@example.test`;
    // Le CONTACT ne correspond que par « contient » sur son nom ; le dossier historique par email
    // exact. Le dossier passe devant : la pertinence textuelle prime sur la nature du résultat.
    await unContact({ nom: `${M} AAA ${cible} dans le nom` });
    const dossier = await unAcquereurHistorique({ nom: `${M} ZZZ Email`, email: cible });

    const { items } = await chercher(cible);

    expect(cles(items)[0]).toBe(`acquereur:${dossier.id}`);
  });

  it("K. le nom complet exact passe devant un préfixe ; à égalité, le Contact précède le dossier", async () => {
    const contact = await unContact({ nom: `${M}Nomc`, prenom: `${M}Pre` });
    const dossier = await unAcquereurHistorique({ nom: `${M}Nomc`, prenom: `${M}Pre` });
    const prefixe = await unProspectHistorique({ nom: `${M}Nomc suite`, prenom: `${M}Pre` });

    const { items } = await chercher(`${M}Pre ${M}Nomc`);

    expect(cles(items)).toEqual([`contact:${contact.id}`, `acquereur:${dossier.id}`, `vendeur:${prefixe.id}`]);
  });

  it("I. un workspace ne voit aucune des trois sources d'un autre workspace", async () => {
    const autre = `test-mixte-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre mixte" });
    idsWorkspaces.push(autre);
    const email = `${M}.isolation@example.test`;

    const ici = await unContact({ nom: `${M} Isolation`, email });
    await unContact({ nom: `${M} Isolation`, email }, autre);
    await unAcquereurHistorique({ nom: `${M} Isolation`, email }, autre);
    await unProspectHistorique({ nom: `${M} Isolation`, email }, autre);

    expect(cles((await chercher(email)).items)).toEqual([`contact:${ici.id}`]);
    const ailleurs = (await chercher(email, autre)).items;
    expect(ailleurs).toHaveLength(3);
    expect(ailleurs.map((i) => i.type).sort()).toEqual(["contact", "legacy_acquereur", "legacy_vendeur"]);
  });

  it("L. la pagination est globale : aucune ligne perdue ni répétée entre les pages, toutes sources confondues", async () => {
    const P = `${M}Pag`;
    const attendus: string[] = [];
    for (let i = 0; i < 3; i += 1) attendus.push(`contact:${(await unContact({ nom: `${P} ${i}` })).id}`);
    for (let i = 0; i < 3; i += 1)
      attendus.push(`acquereur:${(await unAcquereurHistorique({ nom: `${P} ${i}`, prenom: "" })).id}`);
    for (let i = 0; i < 3; i += 1) attendus.push(`vendeur:${(await unProspectHistorique({ nom: `${P} ${i}` })).id}`);

    const vus: string[] = [];
    let decalage = 0;
    let hasMore = true;
    let pages = 0;
    while (hasMore) {
      const page = await chercher(P, WORKSPACE_TEST, 4, decalage);
      vus.push(...cles(page.items));
      hasMore = page.hasMore;
      decalage += 4;
      pages += 1;
    }

    expect(pages).toBe(3);
    expect(vus).toHaveLength(9);
    expect([...vus].sort()).toEqual([...attendus].sort());
    // À rang et nom égaux, l'ordre est contact, puis acquéreur, puis vendeur, puis id.
    expect(vus.slice(0, 3).map((c) => c.split(":")[0])).toEqual(["contact", "acquereur", "vendeur"]);
  });

  it("M. requête vide : uniquement des Contacts récents, jamais un dossier historique", async () => {
    await unAcquereurHistorique({ nom: `${M} Recent legacy` });
    const contact = await unContact({ nom: `${M} Recent contact` });

    const { items } = await chercher("", WORKSPACE_TEST, 5);

    expect(items.every((i) => i.type === "contact")).toBe(true);
    expect(cles(items)).toContain(`contact:${contact.id}`);
  });

  it("N. la recherche n'écrit rien : aucun rattachement, aucun contact créé", async () => {
    const email = `${M}.readonly@example.test`;
    const contact = await unContact({ nom: `${M} Readonly`, email });
    const dossier = await unAcquereurHistorique({ nom: `${M} Readonly`, email });
    const prospect = await unProspectHistorique({ nom: `${M} Readonly`, email });
    const avant = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.email, email));

    await chercher(email);
    await chercher(`${M} Readonly`);

    const [acq] = await getDb().select({ contactId: acquereursTable.contactId }).from(acquereursTable).where(eq(acquereursTable.id, dossier.id));
    const [pro] = await getDb()
      .select({ contactId: prospectsVendeursTable.contactId })
      .from(prospectsVendeursTable)
      .where(eq(prospectsVendeursTable.id, prospect.id));
    const apres = await getDb().select({ id: contactsTable.id }).from(contactsTable).where(eq(contactsTable.email, email));

    expect(acq!.contactId).toBeNull();
    expect(pro!.contactId).toBeNull();
    expect(apres).toHaveLength(avant.length);
    expect(apres[0]!.id).toBe(contact.id);
  });
});
