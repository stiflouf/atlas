import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-054 — périmètre résolu depuis la session.
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
  interactions: interactionsTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const FicheContact = (await import("./page")).default;

// ADR-059 — la fiche d'un Contact ABSORBÉ : une page qui explique (HTTP 200, aucune redirection),
// montre l'identité figée et la date, et n'offre qu'un geste : ouvrir le contact actif.
const M = `Zfusionne${Date.now()}`;
const idsContacts: string[] = [];
const idsProjetsA: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: null, fusionneLe: null })
      .where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
});

async function unContact(surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string }) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

async function absorber(absorbeId: string, survivantId: string) {
  await getDb()
    .update(contactsTable)
    .set({ fusionneDansContactId: survivantId, fusionneLe: new Date("2026-09-02T09:00:00.000Z") })
    .where(eq(contactsTable.id, absorbeId));
}

async function rendre(id: string): Promise<string> {
  return renderToStaticMarkup(await FicheContact({ params: Promise.resolve({ id }) }));
}

describe("/contacts/[id] — contact absorbé", () => {
  it("rend la page « fusionné » : identité figée, date, lien vers le contact actif — sans redirection", async () => {
    const survivant = await unContact({ nom: `${M} Survivant`, prenom: "Sam" });
    const absorbe = await unContact({
      nom: `${M} Absorbé`,
      prenom: "Ana",
      email: `${M}.absorbe@example.test`,
      telephone: "06 55 44 33 22",
    });
    await absorber(absorbe.id, survivant.id);

    const html = await rendre(absorbe.id);

    expect(html).toContain("Ce contact a été fusionné");
    expect(html).toContain("Ce contact a été fusionné avec un autre contact.");
    expect(html).toContain(`Ana ${M} Absorbé`);
    expect(html).toContain(`${M}.absorbe@example.test`);
    expect(html).toContain("06 55 44 33 22");
    expect(html).toMatch(/Fusionné le <time dateTime="2026-09-02T09:00:00.000Z">2 septembre 2026<\/time>/);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/contacts/${survivant.id}"[^>]*>[^<]*Voir le contact actif`));
    expect(html).toContain('href="/contacts"');
  });

  it("aucun geste ni section : ni Modifier, ni projets, ni interactions, ni similaires, ni formulaire", async () => {
    const survivant = await unContact({ nom: `${M} Survivant 2`, email: `${M}.partage@example.test` });
    const absorbe = await unContact({ nom: `${M} Absorbé 2`, email: `${M}.partage@example.test` });
    const projet = await creerProjetAcquereur(
      { budgetMin: 100_000, budgetMax: 200_000, criteres: [], stadeProjet: "recherche_active" },
      WORKSPACE_TEST
    );
    idsProjetsA.push(projet.id);
    await ajouterPartieProjet({ contactId: absorbe.id, projetAcquereurId: projet.id, role: "acquereur" });
    await creerInteraction({ contactId: absorbe.id, type: "appel", sens: "entrant", survenuLe: "2026-03-01T10:00:00.000Z" });
    await absorber(absorbe.id, survivant.id);

    const html = await rendre(absorbe.id);

    expect(html).not.toContain(`/contacts/${absorbe.id}/modifier`);
    expect(html).not.toContain(">Modifier<");
    expect(html).not.toContain("Projets acquéreur");
    expect(html).not.toContain(">Historique<");
    expect(html).not.toContain("Noter un échange");
    expect(html).not.toContain("Contacts partageant un email ou un téléphone");
    expect(html).not.toMatch(/<form|<button|mailto:|tel:/);
    expect(html).not.toMatch(/fusionner|doublon/i);
  });

  it("A → B → C : les fiches de A et de B proposent le contact actif FINAL C, jamais le maillon B", async () => {
    const c = await unContact({ nom: `${M} Chaîne C` });
    const b = await unContact({ nom: `${M} Chaîne B` });
    const a = await unContact({ nom: `${M} Chaîne A` });
    await absorber(b.id, c.id);
    await absorber(a.id, b.id);

    const ficheA = await rendre(a.id);
    expect(ficheA).toMatch(new RegExp(`<a[^>]*href="/contacts/${c.id}"[^>]*>[^<]*Voir le contact actif`));
    expect(ficheA).not.toContain(`href="/contacts/${b.id}"`);
    const ficheB = await rendre(b.id);
    expect(ficheB).toMatch(new RegExp(`<a[^>]*href="/contacts/${c.id}"[^>]*>[^<]*Voir le contact actif`));
  });

  it("le survivant garde sa fiche active ordinaire, sans mention de l'absorbé", async () => {
    const survivant = await unContact({ nom: `${M} Survivant 3` });
    const absorbe = await unContact({ nom: `${M} Absorbé 3` });
    await absorber(absorbe.id, survivant.id);

    const html = await rendre(survivant.id);

    expect(html).toContain(`/contacts/${survivant.id}/modifier`);
    expect(html).toContain(">Historique<");
    expect(html).not.toContain("Ce contact a été fusionné");
    expect(html).not.toContain(absorbe.id);
  });
});
