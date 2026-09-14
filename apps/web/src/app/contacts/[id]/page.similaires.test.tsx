import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-054 — périmètre résolu depuis la session (mock modifiable par test pour l'isolation).
const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const FicheContact = (await import("./page")).default;

// ADR-055 §H — la fiche SIGNALE les Contacts partageant un email ou un téléphone, tels que le read
// model les livre, et ne propose aucun geste. Ce fichier ne teste que cette section ; le reste de
// la fiche est couvert par page.test.tsx, inchangé.
const M = `Zsimf${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;
const unTelephone = () => `09${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++compteur).padStart(2, "0")}`;

const TITRE = "Contacts partageant un email ou un téléphone";

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
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

async function unContact(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string },
  workspace = WORKSPACE_TEST
) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjetAcquereur(contactId: string) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 300_000, budgetMax: 450_000, criteres: [], stadeProjet: "recherche_active" },
    WORKSPACE_TEST
  );
  idsProjetsA.push(projet.id);
  await ajouterPartieProjet({ contactId, projetAcquereurId: projet.id, role: "acquereur" });
}

async function unProjetVendeur(contactId: string) {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  await ajouterPartieProjet({ contactId, projetVendeurId: projet.id, role: "vendeur" });
}

async function rendre(id: string): Promise<string> {
  return renderToStaticMarkup(await FicheContact({ params: Promise.resolve({ id }) }));
}

function section(html: string): string | undefined {
  return html.match(new RegExp(`<h2[^>]*>${TITRE}</h2>[\\s\\S]*?(?=<h2|$)`))?.[0];
}

function carte(html: string, contactId: string): string | undefined {
  // Un <article> par candidat, identifié par le lien vers sa fiche.
  return html.match(new RegExp(`<article[^>]*>(?:(?!<article)[\\s\\S])*?href="/contacts/${contactId}"[\\s\\S]*?</article>`))?.[0];
}

describe("/contacts/[id] — section absente", () => {
  it("A. aucun candidat : aucune section, aucun état vide", async () => {
    const a = await unContact({ nom: `${M} Seul`, email: unEmail(), telephone: unTelephone() });
    const html = await rendre(a.id);
    expect(html).not.toContain(TITRE);
    expect(html).not.toMatch(/doublon/i);
  });

  it("F. même nom et prénom, coordonnées distinctes : aucune section", async () => {
    const a = await unContact({ nom: `${M} Martin`, prenom: "Jean", email: unEmail() });
    await unContact({ nom: `${M} Martin`, prenom: "Jean", email: unEmail() });
    expect(await rendre(a.id)).not.toContain(TITRE);
  });

  it("contact sans email ni téléphone : fiche normale, aucune section", async () => {
    const a = await unContact({ nom: `${M} Vide`, prenom: "Marie" });
    await unContact({ nom: `${M} Vide`, prenom: "Marie" });
    const html = await rendre(a.id);
    expect(html).toContain("Aucune coordonnée enregistrée");
    expect(html).not.toContain(TITRE);
  });
});

describe("/contacts/[id] — section visible", () => {
  it("B. même email à casse différente : section, candidat, « Même email »", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Famille`, email: email.toLowerCase() });
    const b = await unContact({ nom: `${M} Famille bis`, email: email.toUpperCase() });
    const html = await rendre(a.id);
    const s = section(html);
    expect(s).toBeDefined();
    expect(s).toContain("ne signifie pas nécessairement");
    const c = carte(s!, b.id);
    expect(c).toBeDefined();
    expect(c).toContain("Même email");
    expect(c).not.toContain("Même téléphone");
    expect(c).not.toContain("Même nom et prénom");
    expect(c).toContain(email.toUpperCase());
  });

  it("C. 06 vs +33 : « Même téléphone »", async () => {
    const national = unTelephone();
    const a = await unContact({ nom: `${M} Tel`, telephone: national });
    const b = await unContact({ nom: `${M} Tel bis`, telephone: `+33 ${national.slice(1)}` });
    const c = carte(section(await rendre(a.id))!, b.id);
    expect(c).toContain("Même téléphone");
    expect(c).not.toContain("Même email");
  });

  it("D. email + téléphone : deux signaux, dans l'ordre email puis téléphone", async () => {
    const email = unEmail();
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} Deux`, email, telephone });
    const b = await unContact({ nom: `${M} Deux bis`, email, telephone });
    const c = carte(section(await rendre(a.id))!, b.id)!;
    expect(c.indexOf("Même email")).toBeGreaterThan(-1);
    expect(c.indexOf("Même téléphone")).toBeGreaterThan(c.indexOf("Même email"));
    expect(c).not.toContain("Même nom et prénom");
  });

  it("E. nom et prénom identiques en plus : troisième signal « Même nom et prénom »", async () => {
    const email = unEmail();
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} Trois`, prenom: "Jean-Pierre", email, telephone });
    const b = await unContact({ nom: `${M} TROIS`, prenom: "jean pierre", email, telephone });
    const c = carte(section(await rendre(a.id))!, b.id)!;
    expect(c).toContain("Même email");
    expect(c).toContain("Même téléphone");
    expect(c).toContain("Même nom et prénom");
  });

  it("G. trois Contacts sur le même email : les deux autres rendus, dans l'ordre du read model", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Groupe A`, email });
    const b = await unContact({ nom: `${M} Groupe B`, email });
    const c = await unContact({ nom: `${M} Groupe C`, email });
    const s = section(await rendre(a.id))!;
    expect(carte(s, b.id)).toBeDefined();
    expect(carte(s, c.id)).toBeDefined();
    expect(s.indexOf(`/contacts/${b.id}`)).toBeLessThan(s.indexOf(`/contacts/${c.id}`));
    expect(s.match(/<article/g)).toHaveLength(2);
  });

  it("H. candidat avec rôles : badges Acquéreur et Vendeur, nombre de projets", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Roles`, email });
    const b = await unContact({ nom: `${M} Roles bis`, email });
    await unProjetAcquereur(b.id);
    await unProjetAcquereur(b.id);
    await unProjetVendeur(b.id);
    const c = carte(section(await rendre(a.id))!, b.id)!;
    expect(c).toContain("Acquéreur");
    expect(c).toContain("Vendeur");
    expect(c).toContain("3 projets");
  });

  it("I. candidat sans projet : aucun badge de rôle, « Aucun projet »", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} SansProjet`, email });
    const b = await unContact({ nom: `${M} SansProjet bis`, email });
    const c = carte(section(await rendre(a.id))!, b.id)!;
    expect(c).not.toContain("Acquéreur");
    expect(c).not.toContain("Vendeur");
    expect(c).toContain("Aucun projet");
  });

  it("un seul projet : « 1 projet »", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} UnProjet`, email });
    const b = await unContact({ nom: `${M} UnProjet bis`, email });
    await unProjetVendeur(b.id);
    expect(carte(section(await rendre(a.id))!, b.id)).toContain("1 projet<");
  });

  it("J. chaque candidat a un lien explicite « Voir le contact » vers sa fiche", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Lien`, email });
    const b = await unContact({ nom: `${M} Lien bis`, email });
    const c = carte(section(await rendre(a.id))!, b.id)!;
    expect(c).toMatch(new RegExp(`<a[^>]*href="/contacts/${b.id}"[^>]*>[^<]*Voir le contact`));
  });

  it("O. coordonnées optionnelles : le nom complet vient de nomPersonne, l'absent n'est pas rendu", async () => {
    const telephone = unTelephone();
    const a = await unContact({ nom: `${M} Partiel`, telephone });
    const b = await unContact({ nom: `${M} Partiel bis`, prenom: "Zoé", telephone });
    const c = carte(section(await rendre(a.id))!, b.id)!;
    expect(c).toContain(`Zoé ${M} Partiel bis`);
    expect(c).not.toMatch(/undefined|null|mailto:/);
    expect(c).toContain(telephone);
  });
});

describe("/contacts/[id] — périmètre et absence de geste", () => {
  it("K. le contact courant n'apparaît jamais dans sa propre section", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Self`, email });
    await unContact({ nom: `${M} Self bis`, email });
    const s = section(await rendre(a.id))!;
    expect(s).not.toContain(`/contacts/${a.id}"`);
    expect(s.match(/<article/g)).toHaveLength(1);
  });

  it("L. un contact d'un autre workspace n'apparaît pas, même avec le même email", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre similarité fiche" });
    idsWorkspaces.push(autre);
    const email = unEmail();
    const a = await unContact({ nom: `${M} Isolation`, email });
    await unContact({ nom: `${M} Isolation ailleurs`, email }, autre);
    expect(await rendre(a.id)).not.toContain(TITRE);
  });

  it("M/N. aucun bouton Fusionner, aucun formulaire, aucun verdict", async () => {
    const email = unEmail();
    const a = await unContact({ nom: `${M} Geste`, email });
    await unContact({ nom: `${M} Geste bis`, email });
    const html = await rendre(a.id);
    expect(section(html)).toBeDefined();
    expect(html).not.toMatch(/fusionn|rattacher|<form|<button|doublon/i);
    // Le seul « même personne » de la page est nié.
    expect(html.match(/même personne/g)).toHaveLength(1);
    expect(html).toContain("ne signifie pas nécessairement");
  });
});
