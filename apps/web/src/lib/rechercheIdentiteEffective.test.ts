import { afterAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-057 — la recherche `q` des listes /clients et /prospects-vendeurs cherche l'identité
// EFFECTIVE, celle que la liste affiche : le Contact pour un dossier rattaché, l'instantané sinon.
// Aucun repli champ par champ (un Contact sans email ne se retrouve pas par l'ancienne adresse du
// dossier), l'unité de résultat reste le dossier, le filtre s'applique en SQL avant la pagination.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  prospectsVendeurs: prospectsVendeursTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur, rechercherAcquereursPage } = await import("@/lib/clientRepository");
const { creerProspectVendeur, rechercherProspectsVendeurs } = await import("@/lib/prospectVendeurRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");

// Marqueur unique par exécution : les recherches sont des « contient », un suffixe partagé avec une
// autre suite ferait remonter ses lignes.
const M = `Zrecheff${Date.now()}`;
let compteur = 0;
const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unContact(identite: { nom: string; prenom?: string; email?: string; telephone?: string }) {
  const contact = await creerContact(identite, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

async function unAcquereur(snapshot: { nom: string; prenom: string; email?: string; telephone?: string }, contactId?: string) {
  const dossier = await creerAcquereur(
    {
      prenom: snapshot.prenom,
      nom: snapshot.nom,
      email: snapshot.email ?? `${M}.a${++compteur}@example.test`,
      telephone: snapshot.telephone ?? "0600000000",
      budgetMin: 100_000,
      budgetMax: 200_000,
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

async function unProspect(snapshot: { nom: string; prenom?: string; email?: string; telephone?: string }, contactId?: string) {
  const prospect = await creerProspectVendeur(
    {
      nom: snapshot.nom,
      prenom: snapshot.prenom,
      email: snapshot.email,
      telephone: snapshot.telephone,
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

const idsBuyer = async (q: string) =>
  (await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q, archives: false, page: 1, parPage: 100 })).lignes.map((l) => l.id);
const idsSeller = async (q: string) => (await rechercherProspectsVendeurs({ workspaceId: WORKSPACE_TEST, q, vue: "en_cours" })).map((p) => p.id);

describe("recherche sur l'identité effective — /clients (rechercherAcquereursPage)", () => {
  it("A. non rattaché : trouvé par son instantané (nom, prénom, email, téléphone)", async () => {
    const acq = await unAcquereur({ nom: `${M}DurandA`, prenom: `${M}BobA`, email: `${M}.boba@example.test`, telephone: `06${M.length}0000A1` });
    for (const q of [`${M}DurandA`, `${M}boba`, `${M}.boba@example`, `${M.length}0000A1`]) {
      expect(await idsBuyer(q), q).toContain(acq.id);
    }
  });

  it("B/C. rattaché : trouvé par le Contact, plus jamais par l'ancien instantané", async () => {
    const alice = await unContact({ nom: `${M}MartinB`, prenom: `${M}AliceB` });
    const acq = await unAcquereur({ nom: `${M}DurandB`, prenom: `${M}BobB` }, alice.id);
    expect(await idsBuyer(`${M}MartinB`)).toContain(acq.id);
    expect(await idsBuyer(`${M}aliceb`)).toContain(acq.id);
    expect(await idsBuyer(`${M}DurandB`)).not.toContain(acq.id);
    expect(await idsBuyer(`${M}BobB`)).not.toContain(acq.id);
    const { lignes } = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinB`, archives: false, page: 1, parPage: 100 });
    // Ce qui est cherché est ce qui est affiché.
    expect(lignes.find((l) => l.id === acq.id)).toMatchObject({ nom: `${M}MartinB`, prenom: `${M}AliceB` });
  });

  it("D/E. email : celui du Contact trouve, l'ancien email du dossier ne trouve plus", async () => {
    const alice = await unContact({ nom: `${M}MartinD`, email: `${M}.aliced@example.test` });
    const acq = await unAcquereur({ nom: `${M}DurandD`, prenom: "Bob", email: `${M}.bobd@example.test` }, alice.id);
    expect(await idsBuyer(`${M}.aliced@example.test`)).toContain(acq.id);
    expect(await idsBuyer(`${M}.bobd@example.test`)).not.toContain(acq.id);
  });

  it("F. Contact sans email ni téléphone ni prénom : aucun repli sur l'instantané (ADR-057)", async () => {
    const sansEmail = await unContact({ nom: `${M}MartinF` });
    const acq = await unAcquereur(
      { nom: `${M}DurandF`, prenom: `${M}BobF`, email: `${M}.bobf@example.test`, telephone: `07${M.length}0000F1` },
      sansEmail.id
    );
    expect(await idsBuyer(`${M}MartinF`)).toContain(acq.id);
    expect(await idsBuyer(`${M}.bobf@example.test`)).not.toContain(acq.id);
    expect(await idsBuyer(`${M.length}0000F1`)).not.toContain(acq.id);
    expect(await idsBuyer(`${M}BobF`)).not.toContain(acq.id);
  });

  it("G. nom et prénom se cherchent séparément, comme avant (ADR-048) — sur l'identité effective", async () => {
    const alice = await unContact({ nom: `${M}MartinG`, prenom: `${M}AliceG` });
    const acq = await unAcquereur({ nom: `${M}DurandG`, prenom: `${M}BobG` }, alice.id);
    expect(await idsBuyer(`${M}AliceG`)).toContain(acq.id);
    expect(await idsBuyer(`${M}MartinG`)).toContain(acq.id);
    expect(await idsBuyer(`${M}BobG ${M}DurandG`)).not.toContain(acq.id);
  });

  it("H. deux dossiers liés au même Contact : deux résultats, l'unité reste le dossier", async () => {
    const alice = await unContact({ nom: `${M}MartinH`, prenom: "Alice" });
    const acq1 = await unAcquereur({ nom: `${M}DurandH1`, prenom: "Bob" }, alice.id);
    const acq2 = await unAcquereur({ nom: `${M}DurandH2`, prenom: "Bob" }, alice.id);
    const ids = await idsBuyer(`${M}MartinH`);
    expect(ids).toContain(acq1.id);
    expect(ids).toContain(acq2.id);
    expect(ids.filter((id) => id === acq1.id || id === acq2.id)).toHaveLength(2);
  });

  it("I. le filtre effectif s'applique avant LIMIT/OFFSET : total exact, pages disjointes, ordre conservé", async () => {
    const alice = await unContact({ nom: `${M}MartinI`, prenom: "Alice" });
    const crees = [];
    for (let i = 0; i < 5; i++) crees.push(await unAcquereur({ nom: `${M}DurandI${i}`, prenom: "Bob" }, alice.id));
    const page1 = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinI`, archives: false, page: 1, parPage: 2 });
    const page2 = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinI`, archives: false, page: 2, parPage: 2 });
    const page3 = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinI`, archives: false, page: 3, parPage: 2 });
    expect(page1.total).toBe(5);
    expect(page1.lignes).toHaveLength(2);
    expect(page2.lignes).toHaveLength(2);
    expect(page3.lignes).toHaveLength(1);
    const ids = [...page1.lignes, ...page2.lignes, ...page3.lignes].map((l) => l.id);
    expect(ids).toEqual([...crees].reverse().map((a) => a.id));
    expect((await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}DurandI`, archives: false, page: 1, parPage: 2 })).total).toBe(0);
  });

  it("le filtre archives reste combiné au filtre effectif", async () => {
    const alice = await unContact({ nom: `${M}MartinArch`, prenom: "Alice" });
    const acq = await unAcquereur({ nom: `${M}DurandArch`, prenom: "Bob" }, alice.id);
    expect((await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinArch`, archives: true, page: 1, parPage: 100 })).lignes.map((l) => l.id)).not.toContain(acq.id);
  });

  it("nombre de requêtes borné : 2 pour la recherche (page + total) puis les projections batchées, jamais une par ligne", async () => {
    const alice = await unContact({ nom: `${M}MartinN`, prenom: "Alice" });
    for (let i = 0; i < 4; i++) await unAcquereur({ nom: `${M}DurandN${i}`, prenom: "Bob" }, alice.id);
    const espion = vi.spyOn(getDb(), "select");
    const { lignes } = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinN`, archives: false, page: 1, parPage: 100 });
    const n = espion.mock.calls.length;
    espion.mockRestore();
    expect(lignes).toHaveLength(4);
    expect(n).toBe(4);
  });
});

describe("recherche sur l'identité effective — /prospects-vendeurs (rechercherProspectsVendeurs)", () => {
  it("A. non rattaché : trouvé par son instantané (nom, prénom, email, téléphone)", async () => {
    const pro = await unProspect({ nom: `${M}DurandSA`, prenom: `${M}BobSA`, email: `${M}.bobsa@example.test`, telephone: `06${M.length}00SA1` });
    for (const q of [`${M}DurandSA`, `${M}bobsa`, `${M}.bobsa@example`, `${M.length}00SA1`]) {
      expect(await idsSeller(q), q).toContain(pro.id);
    }
  });

  it("B/C. rattaché : trouvé par le Contact, plus jamais par l'ancien instantané", async () => {
    const alice = await unContact({ nom: `${M}MartinSB`, prenom: `${M}AliceSB` });
    const pro = await unProspect({ nom: `${M}DurandSB`, prenom: `${M}BobSB` }, alice.id);
    expect(await idsSeller(`${M}MartinSB`)).toContain(pro.id);
    expect(await idsSeller(`${M}alicesb`)).toContain(pro.id);
    expect(await idsSeller(`${M}DurandSB`)).not.toContain(pro.id);
    expect(await idsSeller(`${M}BobSB`)).not.toContain(pro.id);
    const resultat = await rechercherProspectsVendeurs({ workspaceId: WORKSPACE_TEST, q: `${M}MartinSB`, vue: "en_cours" });
    expect(resultat.find((p) => p.id === pro.id)).toMatchObject({ nom: `${M}MartinSB`, prenom: `${M}AliceSB` });
  });

  it("D/E. email : celui du Contact trouve, l'ancien email du dossier ne trouve plus", async () => {
    const alice = await unContact({ nom: `${M}MartinSD`, email: `${M}.alicesd@example.test` });
    const pro = await unProspect({ nom: `${M}DurandSD`, email: `${M}.bobsd@example.test` }, alice.id);
    expect(await idsSeller(`${M}.alicesd@example.test`)).toContain(pro.id);
    expect(await idsSeller(`${M}.bobsd@example.test`)).not.toContain(pro.id);
  });

  it("F. Contact sans email ni téléphone ni prénom : aucun repli sur l'instantané (ADR-057)", async () => {
    const sansEmail = await unContact({ nom: `${M}MartinSF` });
    const pro = await unProspect(
      { nom: `${M}DurandSF`, prenom: `${M}BobSF`, email: `${M}.bobsf@example.test`, telephone: `07${M.length}00SF1` },
      sansEmail.id
    );
    expect(await idsSeller(`${M}MartinSF`)).toContain(pro.id);
    expect(await idsSeller(`${M}.bobsf@example.test`)).not.toContain(pro.id);
    expect(await idsSeller(`${M.length}00SF1`)).not.toContain(pro.id);
    expect(await idsSeller(`${M}BobSF`)).not.toContain(pro.id);
  });

  it("H. deux prospects liés au même Contact : deux résultats", async () => {
    const alice = await unContact({ nom: `${M}MartinSH`, prenom: "Alice" });
    const pro1 = await unProspect({ nom: `${M}DurandSH1` }, alice.id);
    const pro2 = await unProspect({ nom: `${M}DurandSH2` }, alice.id);
    const ids = await idsSeller(`${M}MartinSH`);
    expect(ids).toContain(pro1.id);
    expect(ids).toContain(pro2.id);
  });

  it("la vue reste combinée au filtre effectif (ordre creeLe DESC, id DESC conservé)", async () => {
    const alice = await unContact({ nom: `${M}MartinSV`, prenom: "Alice" });
    const premier = await unProspect({ nom: `${M}DurandSV1` }, alice.id);
    const second = await unProspect({ nom: `${M}DurandSV2` }, alice.id);
    const enCours = await idsSeller(`${M}MartinSV`);
    expect(enCours.indexOf(second.id)).toBeLessThan(enCours.indexOf(premier.id));
    expect((await rechercherProspectsVendeurs({ workspaceId: WORKSPACE_TEST, q: `${M}MartinSV`, vue: "perdus" })).map((p) => p.id)).not.toContain(premier.id);
  });
});

describe("recherche après fusion réelle B → A (moteur)", () => {
  it("J. Alice retrouve les dossiers historiques de Bob, Bob ne les retrouve plus — nom et email, acquéreur et vendeur", async () => {
    const a = await unContact({ nom: `${M}MartinJ`, prenom: "Alice", email: `${M}.alicej@example.test` });
    const b = await unContact({ nom: `${M}DurandJ`, prenom: "Bob", email: `${M}.bobj@example.test` });
    const acq = await unAcquereur({ nom: `${M}DurandJ`, prenom: "Bob", email: `${M}.bobj@example.test` }, b.id);
    const pro = await unProspect({ nom: `${M}DurandJ`, prenom: "Bob", email: `${M}.bobj@example.test` }, b.id);
    expect(await idsBuyer(`${M}DurandJ`)).toContain(acq.id);
    expect(await idsSeller(`${M}DurandJ`)).toContain(pro.id);

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

    for (const q of [`${M}MartinJ`, `${M}.alicej@example.test`]) {
      expect(await idsBuyer(q), q).toContain(acq.id);
      expect(await idsSeller(q), q).toContain(pro.id);
    }
    for (const q of [`${M}DurandJ`, `${M}.bobj@example.test`]) {
      expect(await idsBuyer(q), q).not.toContain(acq.id);
      expect(await idsSeller(q), q).not.toContain(pro.id);
    }
    const { lignes } = await rechercherAcquereursPage({ workspaceId: WORKSPACE_TEST, q: `${M}MartinJ`, archives: false, page: 1, parPage: 100 });
    expect(lignes.find((l) => l.id === acq.id)).toMatchObject({ nom: a.nom, prenom: "Alice", email: a.email });
  });
});
