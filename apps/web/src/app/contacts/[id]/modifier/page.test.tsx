import { afterAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

const { workspaceCourantMock } = vi.hoisted(() => ({ workspaceCourantMock: vi.fn() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: () => workspaceCourantMock(),
}));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { acquereurs: acquereursTable, contacts: contactsTable, workspaces: workspacesTable } = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const ModifierContactPage = (await import("./page")).default;
const FicheContact = (await import("../page")).default;

// ADR-057 — le formulaire d'identité canonique : prérempli depuis le Contact et lui seul, un champ
// absent rendu vide, jamais une colonne de dossier.
const M = `Zform${Date.now()}`;

const idsContacts: string[] = [];
const idsAcquereurs: string[] = [];
const idsWorkspaces: string[] = [];

workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsContacts.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(surcharge: Record<string, unknown> = {}, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Dupont`, ...surcharge } as never, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function rendre(id: string): Promise<string> {
  return renderToStaticMarkup(await ModifierContactPage({ params: Promise.resolve({ id }) }));
}

function baliseInput(html: string, name: string): string | undefined {
  return html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0];
}

function valeurInput(html: string, name: string): string | undefined {
  return baliseInput(html, name)?.match(/value="([^"]*)"/)?.[1];
}

describe("/contacts/[id]/modifier", () => {
  it("préremplit les quatre champs depuis le Contact, avec titre, retour et Annuler vers la fiche", async () => {
    const contact = await unContact({ prenom: "Jean", email: `${M}@example.test`, telephone: "0611223344" });

    const html = await rendre(contact.id);

    expect(html).toContain("Modifier le contact");
    expect(valeurInput(html, "id")).toBe(contact.id);
    expect(valeurInput(html, "nom")).toBe(`${M} Dupont`);
    expect(valeurInput(html, "prenom")).toBe("Jean");
    expect(valeurInput(html, "email")).toBe(`${M}@example.test`);
    expect(valeurInput(html, "telephone")).toBe("0611223344");
    expect(html).toContain(`href="/contacts/${contact.id}"`);
    expect(html).toContain("Annuler");
    expect(html).toContain('type="submit"');
    expect(html).toContain("Enregistrer");
  });

  it("prénom, email et téléphone absents → inputs vides, jamais « undefined » ni « null »", async () => {
    const contact = await unContact();

    const html = await rendre(contact.id);

    expect(valeurInput(html, "prenom")).toBe("");
    expect(valeurInput(html, "email")).toBe("");
    expect(valeurInput(html, "telephone")).toBe("");
    // Hors script de relecture de formulaire injecté par React : seul le HTML visible compte.
    expect(html.replace(/<script[\s\S]*?<\/script>/g, "")).not.toMatch(/undefined|null/);
  });

  it("le nom est obligatoire dans le formulaire, les autres champs non", async () => {
    const contact = await unContact();
    const html = await rendre(contact.id);
    expect(baliseInput(html, "nom")).toContain("required");
    for (const optionnel of ["prenom", "email", "telephone"]) {
      expect(baliseInput(html, optionnel)).not.toContain("required");
    }
  });

  it("les champs viennent du Contact, jamais du dossier rattaché", async () => {
    const contact = await unContact({ nom: `${M} Canonique` });
    const dossier = await creerAcquereur(
      {
        prenom: "Ancien",
        nom: `${M} Legacy`,
        email: `${M}.legacy@example.test`,
        telephone: "0699999999",
        budgetMin: 100_000,
        budgetMax: 400_000,
        criteres: [],
        stadeProjet: "recherche_active",
        notes: "",
        datePremiereContact: "2026-01-01",
        contactId: contact.id,
      },
      WORKSPACE_TEST
    );
    idsAcquereurs.push(dossier.id);

    const html = await rendre(contact.id);

    expect(valeurInput(html, "nom")).toBe(`${M} Canonique`);
    expect(valeurInput(html, "prenom")).toBe("");
    expect(valeurInput(html, "email")).toBe("");
    expect(html).not.toContain("Legacy");
    expect(html).not.toContain("Ancien");
  });

  it("ADR-059 — un contact absorbé est figé : notFound(), indistinguable d'un inconnu", async () => {
    const survivant = await unContact({ nom: `${M} Survivant` });
    const absorbe = await unContact({ nom: `${M} Absorbé` });
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: survivant.id, fusionneLe: new Date() })
      .where(eq(contactsTable.id, absorbe.id));

    await expect(rendre(absorbe.id)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    // Le survivant reste éditable.
    expect(await rendre(survivant.id)).toContain("Modifier le contact");
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(eq(contactsTable.id, absorbe.id));
  });

  it("autre workspace ou id inconnu : notFound()", async () => {
    const autre = `test-form-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre form" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact({}, autre);

    await expect(rendre(ailleurs.id)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(rendre("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    await expect(rendre("pas-un-uuid")).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });

  it("la fiche Contact propose « Modifier » vers ce formulaire", async () => {
    const contact = await unContact();
    const html = renderToStaticMarkup(await FicheContact({ params: Promise.resolve({ id: contact.id }) }));
    expect(html).toContain(`href="/contacts/${contact.id}/modifier"`);
    expect(html).toContain(">Modifier<");
  });
});
