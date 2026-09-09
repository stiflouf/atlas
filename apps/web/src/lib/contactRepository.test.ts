import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

// ADR-055 — test d'intégration Postgres : `contacts` porte une FK réelle vers `workspaces` et un
// `workspace_id` NOT NULL sans DEFAULT (ADR-054), donc un mock ne prouverait rien de ce qui compte.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const { contacts: contactsTable } = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact, getContactById } = await import("./contactRepository");

const idsCrees: string[] = [];

afterAll(async () => {
  for (const id of idsCrees) {
    await getDb().delete(contactsTable).where(eq(contactsTable.id, id));
  }
});

describe("contactRepository (intégration Postgres)", () => {
  it("crée un contact complet et le relit par son identifiant", async () => {
    const contact = await creerContact(
      {
        nom: "[test réel] Dupont",
        prenom: "Jean",
        email: "jean.dupont@example.test",
        telephone: "0600000000",
      },
      WORKSPACE_TEST
    );
    idsCrees.push(contact.id);

    const relu = await getContactById(contact.id);
    expect(relu).toEqual(contact);
    expect(relu?.nom).toBe("[test réel] Dupont");
    expect(relu?.prenom).toBe("Jean");
  });

  it("crée un contact dont seul le nom est connu — ni prénom, ni email, ni téléphone", async () => {
    // Cas réel du lead de prospection terrain (ADR-027 §1) : exiger un email ici rendrait une
    // partie de l'existant non représentable.
    const contact = await creerContact({ nom: "[test réel] Contact minimal" }, WORKSPACE_TEST);
    idsCrees.push(contact.id);

    expect(contact.prenom).toBeUndefined();
    expect(contact.email).toBeUndefined();
    expect(contact.telephone).toBeUndefined();

    // NULL en base traduit en `undefined` métier, jamais en chaîne vide.
    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, contact.id));
    expect(ligne.email).toBeNull();
  });

  it("écrit explicitement le workspace reçu", async () => {
    const contact = await creerContact({ nom: "[test réel] Contact workspace" }, WORKSPACE_TEST);
    idsCrees.push(contact.id);

    const [ligne] = await getDb()
      .select({ workspaceId: contactsTable.workspaceId })
      .from(contactsTable)
      .where(eq(contactsTable.id, contact.id));
    expect(ligne.workspaceId).toBe(WORKSPACE_TEST);
  });

  it("refuse une insertion brute sans workspace, et une insertion vers un workspace inexistant", async () => {
    await expect(
      getDb().execute(sql`INSERT INTO contacts (nom) VALUES ('[test réel] sans workspace')`)
    ).rejects.toThrow();

    await expect(
      getDb().execute(
        sql`INSERT INTO contacts (nom, workspace_id) VALUES ('[test réel] workspace inconnu', 'workspace-inexistant')`
      )
    ).rejects.toThrow();
  });

  it("deux contacts peuvent partager email et téléphone — aucune unicité n'est imposée", async () => {
    // Décision explicite du lot : un couple partage une adresse, une famille un numéro. Une
    // contrainte UNIQUE bloquerait des saisies vraies ; la déduplication passera par une
    // validation humaine, jamais par le schéma.
    const partages = { email: "foyer@example.test", telephone: "0611111111" };
    const premier = await creerContact({ nom: "[test réel] Foyer A", prenom: "Camille", ...partages }, WORKSPACE_TEST);
    idsCrees.push(premier.id);
    const second = await creerContact({ nom: "[test réel] Foyer A", prenom: "Dominique", ...partages }, WORKSPACE_TEST);
    idsCrees.push(second.id);

    expect(second.id).not.toBe(premier.id);
  });

  it("retourne undefined pour un identifiant inconnu ou non-UUID, sans erreur de cast", async () => {
    await expect(getContactById("contact-001")).resolves.toBeUndefined();
    await expect(getContactById("00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined();
  });
});
