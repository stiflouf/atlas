import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { StadeProjet } from "@/types/client";

// ADR-058 — la recherche de PERSONNES. Deux tests portent à eux seuls la doctrine : email partagé
// et téléphone partagé doivent rendre DEUX résultats. Un couple partage une adresse, une famille un
// numéro ; les regrouper serait décider à la place de l'humain (ADR-055 §H).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { rechercherContacts } = await import("@/lib/rechercheContactRepository");

// Marqueur unique : la base de test est partagée par toute la suite, et cette recherche lit TOUS
// les contacts du workspace. Sans lui, les contacts d'autres fichiers pollueraient les assertions.
const M = `Zrech${Date.now()}`;

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

beforeAll(async () => {
  // Aucun résidu d'une exécution interrompue ne doit se mêler aux résultats.
  await getDb().delete(contactsTable).where(inArray(contactsTable.nom, [`${M} inexistant`]));
});

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
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

async function unProjetAcquereur(contactId: string, stade: StadeProjet = "recherche_active") {
  const projet = await creerProjetAcquereur(
    { budgetMin: 200_000, budgetMax: 500_000, criteres: [], stadeProjet: stade },
    WORKSPACE_TEST
  );
  idsProjetsA.push(projet.id);
  await ajouterPartieProjet({ contactId, projetAcquereurId: projet.id, role: "acquereur" });
  return projet;
}

async function unProjetVendeur(contactId: string) {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  await ajouterPartieProjet({ contactId, projetVendeurId: projet.id, role: "vendeur" });
  return projet;
}

const chercher = (q: string, workspace = WORKSPACE_TEST) =>
  rechercherContacts({ workspaceId: workspace, q, limite: 100 });

describe("rechercherContacts — la personne est l'unité de résultat", () => {
  it("I. un contact multi-rôle donne UNE ligne portant ses deux rôles", async () => {
    const contact = await unContact({ nom: `${M} Multirole` });
    await unProjetAcquereur(contact.id);
    await unProjetVendeur(contact.id);

    const { items } = await chercher(`${M} Multirole`);

    expect(items).toHaveLength(1);
    expect(items[0]!.roles).toEqual(["acquereur", "vendeur"]);
  });

  it("J. plusieurs projets ne dupliquent pas la personne", async () => {
    const contact = await unContact({ nom: `${M} Multiprojets` });
    await unProjetAcquereur(contact.id, "decouverte");
    await unProjetAcquereur(contact.id, "offre");
    await unProjetVendeur(contact.id);

    const { items } = await chercher(`${M} Multiprojets`);

    expect(items).toHaveLength(1);
    expect(items[0]!.projetsAcquereur).toHaveLength(2);
    expect(items[0]!.projetsVendeur).toHaveLength(1);
    expect(items[0]!.roles).toEqual(["acquereur", "vendeur"]);
  });

  it("K. DEUX contacts au même email restent DEUX résultats", async () => {
    // Le test de doctrine. Les regrouper serait la fusion silencieuse qu'ADR-055 §H interdit.
    const partage = `${M}.partage@example.test`;
    const a = await unContact({ nom: `${M} Couple A`, email: partage });
    const b = await unContact({ nom: `${M} Couple B`, email: partage });

    const { items } = await chercher(partage);

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.contactId).sort()).toEqual([a.id, b.id].sort());
  });

  it("L. DEUX contacts au même téléphone restent DEUX résultats", async () => {
    const partage = `0${M.length}77001122`;
    const a = await unContact({ nom: `${M} Famille A`, telephone: partage });
    const b = await unContact({ nom: `${M} Famille B`, telephone: partage });

    const { items } = await chercher(partage);

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.contactId).sort()).toEqual([a.id, b.id].sort());
  });
});

describe("rechercherContacts — champs et ranking", () => {
  it("B/C. trouve par nom et par prénom", async () => {
    const contact = await unContact({ nom: `${M} Dupont`, prenom: `${M}Jeanne` });
    expect((await chercher(`${M} Dupont`)).items.map((i) => i.contactId)).toContain(contact.id);
    expect((await chercher(`${M}Jeanne`)).items.map((i) => i.contactId)).toContain(contact.id);
  });

  it("D. l'email exact passe devant un simple « contient »", async () => {
    const cible = `${M}.exact@example.test`;
    const parEmail = await unContact({ nom: `${M} ZZZ Email`, email: cible });
    // Celui-ci ne correspond que par « contient » sur son nom, et devrait donc passer après.
    await unContact({ nom: `${M} AAA ${cible} dans le nom` });

    const { items } = await chercher(cible);

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.contactId).toBe(parEmail.id);
  });

  it("E. le téléphone exact passe devant un « contient »", async () => {
    const cible = `06${M.length}998877`;
    const parTelephone = await unContact({ nom: `${M} ZZZ Tel`, telephone: cible });
    await unContact({ nom: `${M} AAA ${cible} dans le nom` });

    const { items } = await chercher(cible);

    expect(items[0]!.contactId).toBe(parTelephone.id);
  });

  it("le nom complet est cherchable alors qu'aucune colonne seule ne le contient", async () => {
    // « Jean Dupont » : le prénom est dans une colonne, le nom dans une autre. C'est la recherche la
    // plus naturelle d'une personne, et elle ne rendait rien tant que le filtre testait chaque
    // colonne séparément.
    const contact = await unContact({ nom: `${M}Concat`, prenom: `${M}Prenomconcat` });
    const { items } = await chercher(`${M}Prenomconcat ${M}Concat`);
    expect(items.map((i) => i.contactId)).toContain(contact.id);
  });

  it("F. le nom complet exact passe devant un préfixe", async () => {
    const contact = await unContact({ nom: `${M}Nomcomplet`, prenom: `${M}Prenom` });
    await unContact({ nom: `${M}Prenom ${M}Nomcomplet autre chose` });

    const { items } = await chercher(`${M}Prenom ${M}Nomcomplet`);

    expect(items[0]!.contactId).toBe(contact.id);
  });

  it("G/H. le préfixe passe devant le « contient »", async () => {
    const prefixe = await unContact({ nom: `${M}Prefixe suite` });
    const contient = await unContact({ nom: `debut ${M}Prefixe` });

    const { items } = await chercher(`${M}Prefixe`);
    const rangs = items.map((i) => i.contactId);

    expect(rangs.indexOf(prefixe.id)).toBeLessThan(rangs.indexOf(contient.id));
  });

  it("la casse n'a pas d'importance", async () => {
    const contact = await unContact({ nom: `${M} Casse`, email: `${M}.CASSE@Example.Test` });
    expect((await chercher(`${M.toLowerCase()} casse`)).items.map((i) => i.contactId)).toContain(contact.id);
    expect((await chercher(`${M}.casse@example.test`)).items.map((i) => i.contactId)).toContain(contact.id);
  });
});

describe("rechercherContacts — contexte et absences", () => {
  it("M. un contact sans projet reste trouvable", async () => {
    const contact = await unContact({ nom: `${M} Sansprojet` });
    const { items } = await chercher(`${M} Sansprojet`);
    expect(items).toHaveLength(1);
    expect(items[0]!.roles).toEqual([]);
    expect(items[0]!.projetsAcquereur).toEqual([]);
    expect(items[0]!.projetsVendeur).toEqual([]);
  });

  it("N/O. sans interaction : absence ; avec : la plus récente", async () => {
    const sans = await unContact({ nom: `${M} Sansinteraction` });
    expect((await chercher(`${M} Sansinteraction`)).items[0]!.derniereInteractionLe).toBeUndefined();

    const avec = await unContact({ nom: `${M} Avecinteraction` });
    await creerInteraction({
      contactId: avec.id,
      type: "appel",
      sens: "sortant",
      survenuLe: "2026-03-01T10:00:00.000Z",
    });
    await creerInteraction({
      contactId: avec.id,
      type: "email",
      sens: "sortant",
      survenuLe: "2026-06-15T10:00:00.000Z",
    });

    const { items } = await chercher(`${M} Avecinteraction`);
    expect(new Date(items[0]!.derniereInteractionLe!).toISOString()).toBe("2026-06-15T10:00:00.000Z");
    expect(sans.id).not.toBe(avec.id);
  });

  it("le statut vendeur vient de la primitive métier, pas d'une règle réécrite", async () => {
    const contact = await unContact({ nom: `${M} Statutvendeur` });
    const projet = await unProjetVendeur(contact.id);
    await getDb()
      .update(projetsVendeurTable)
      .set({ qualifieLe: new Date("2026-01-10T09:00:00Z"), mandatProposeLe: new Date("2026-02-01T09:00:00Z") })
      .where(inArray(projetsVendeurTable.id, [projet.id]));

    const { items } = await chercher(`${M} Statutvendeur`);
    // Le jalon le plus avancé réellement atteint l'emporte (ADR-027 §4).
    expect(items[0]!.projetsVendeur[0]!.statut).toBe("mandat_propose");
  });
});

describe("rechercherContacts — workspace, pagination, ordre", () => {
  it("A. un workspace ne voit jamais les contacts d'un autre, même identité identique", async () => {
    const autre = `test-recherche-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre recherche" });
    idsWorkspaces.push(autre);

    const email = `${M}.isolation@example.test`;
    const ici = await unContact({ nom: `${M} Isolation`, email });
    const ailleurs = await unContact({ nom: `${M} Isolation`, email }, autre);

    const vusIci = (await chercher(`${M} Isolation`)).items.map((i) => i.contactId);
    expect(vusIci).toContain(ici.id);
    expect(vusIci).not.toContain(ailleurs.id);

    const vusAilleurs = (await chercher(`${M} Isolation`, autre)).items.map((i) => i.contactId);
    expect(vusAilleurs).toEqual([ailleurs.id]);
  });

  it("P/Q. pagination stable : aucune ligne perdue ni répétée entre deux pages", async () => {
    const noms = ["Page1", "Page2", "Page3", "Page4"];
    for (const nom of noms) await unContact({ nom: `${M}Pagination ${nom}` });

    const page1 = await rechercherContacts({ workspaceId: WORKSPACE_TEST, q: `${M}Pagination`, limite: 2 });
    const page2 = await rechercherContacts({
      workspaceId: WORKSPACE_TEST,
      q: `${M}Pagination`,
      limite: 2,
      decalage: 2,
    });

    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page2.items).toHaveLength(2);
    expect(page2.hasMore).toBe(false);

    const tous = [...page1.items, ...page2.items].map((i) => i.contactId);
    expect(new Set(tous).size).toBe(4);

    // Rejouer la même page rend exactement la même chose : l'ordre ne dépend pas du hasard.
    const page1bis = await rechercherContacts({ workspaceId: WORKSPACE_TEST, q: `${M}Pagination`, limite: 2 });
    expect(page1bis.items.map((i) => i.contactId)).toEqual(page1.items.map((i) => i.contactId));
  });

  it("R. une requête vide rend les contacts récents du workspace, jamais toute la table", async () => {
    const { items, hasMore } = await rechercherContacts({ workspaceId: WORKSPACE_TEST, limite: 3 });
    expect(items.length).toBeLessThanOrEqual(3);
    expect(typeof hasMore).toBe("boolean");
  });

  it("la limite est bornée : on ne peut pas demander toute la base", async () => {
    const { items } = await rechercherContacts({ workspaceId: WORKSPACE_TEST, limite: 100_000 });
    expect(items.length).toBeLessThanOrEqual(100);
  });
});
