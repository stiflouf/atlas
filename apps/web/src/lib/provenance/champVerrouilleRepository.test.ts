import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

// ADR-056 invariant 4 — le verrou humain, de bout en bout : poser le verrou, le relire, et le
// brancher sur la fonction de décision pour rejouer le cas fondateur de l'ADR.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  champsVerrouilles: champsVerrouillesTable,
  contacts: contactsTable,
  projetsAcquereur: projetsAcquereurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { champEstVerrouille, deverrouillerChamp, estChampVerrouillable, listerChampsVerrouilles, verrouillerChamp } =
  await import("./champVerrouilleRepository");
const { deciderApplicationValeurExterne } = await import("./decisionImport");

const contactsCrees: string[] = [];
const projetsCrees: string[] = [];
const workspacesCrees: string[] = [];

async function unContact(nom: string, workspaceId: string = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `[test réel] ${nom}` }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unProjet(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 450_000, criteres: [], stadeProjet: "decouverte" },
    workspaceId
  );
  projetsCrees.push(projet.id);
  return projet;
}

afterAll(async () => {
  if (contactsCrees.length > 0) {
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, contactsCrees));
  }
  if (projetsCrees.length > 0) {
    await getDb()
      .delete(champsVerrouillesTable)
      .where(inArray(champsVerrouillesTable.projetAcquereurId, projetsCrees));
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (contactsCrees.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("champs_verrouilles — protéger une correction humaine", () => {
  it("verrouille un champ et le relit", async () => {
    const projet = await unProjet();
    const verrou = await verrouillerChamp({ type: "projet_acquereur", id: projet.id }, "budgetMax", WORKSPACE_TEST);

    expect(verrou.champ).toBe("budgetMax");
    expect(verrou.cible).toEqual({ type: "projet_acquereur", id: projet.id });
    expect(await champEstVerrouille({ type: "projet_acquereur", id: projet.id }, "budgetMax")).toBe(true);
    // Les autres champs restent libres : le verrou protège une valeur, pas une entité.
    expect(await champEstVerrouille({ type: "projet_acquereur", id: projet.id }, "budgetMin")).toBe(false);
  });

  it("verrouiller deux fois est le même fait, et conserve la date du premier verrou", async () => {
    // Cette date dit DEPUIS QUAND la valeur est protégée ; la réécrire à chaque appel l'effacerait.
    const projet = await unProjet();
    const premier = await verrouillerChamp({ type: "projet_acquereur", id: projet.id }, "budgetMax", WORKSPACE_TEST);
    const second = await verrouillerChamp({ type: "projet_acquereur", id: projet.id }, "budgetMax", WORKSPACE_TEST);

    expect(second.id).toBe(premier.id);
    expect(second.verrouilleLe).toBe(premier.verrouilleLe);
    expect(await listerChampsVerrouilles({ type: "projet_acquereur", id: projet.id })).toHaveLength(1);
  });

  it("le déverrouillage est un geste explicite", async () => {
    // ADR-056 §5 : « un override n'est jamais levé automatiquement ». Aucune synchronisation
    // n'appelle cette fonction — seul un humain.
    const contact = await unContact("Déverrouillage");
    await verrouillerChamp({ type: "contact", id: contact.id }, "email", WORKSPACE_TEST);
    expect(await champEstVerrouille({ type: "contact", id: contact.id }, "email")).toBe(true);

    await deverrouillerChamp({ type: "contact", id: contact.id }, "email");
    expect(await champEstVerrouille({ type: "contact", id: contact.id }, "email")).toBe(false);
  });

  it("refuse un champ qui n'appartient pas au type d'entité", async () => {
    // Le verrou nomme une propriété CANONIQUE DOMIORA. `budgetMax` n'existe pas sur un contact, et
    // `playiad.budget` n'existe nulle part : le verrou protège le Core, pas une correspondance.
    const contact = await unContact("Champ inconnu");
    await expect(
      verrouillerChamp({ type: "contact", id: contact.id }, "budgetMax", WORKSPACE_TEST)
    ).rejects.toThrow(/non verrouillable/);
    await expect(
      verrouillerChamp({ type: "contact", id: contact.id }, "playiad.budget", WORKSPACE_TEST)
    ).rejects.toThrow(/non verrouillable/);

    expect(estChampVerrouillable("projet_acquereur", "budgetMax")).toBe(true);
    expect(estChampVerrouillable("contact", "budgetMax")).toBe(false);
  });

  it("refuse une entité inexistante ou d'un autre workspace", async () => {
    await expect(
      verrouillerChamp({ type: "contact", id: "00000000-0000-0000-0000-000000000000" }, "email", WORKSPACE_TEST)
    ).rejects.toThrow(/introuvable/);

    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-verrou", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);
    const ailleurs = await unContact("Verrou ailleurs", autreWorkspace.id);

    await expect(verrouillerChamp({ type: "contact", id: ailleurs.id }, "email", WORKSPACE_TEST)).rejects.toThrow(
      /autre workspace/
    );
  });

  it("le verrou de deux entités différentes ne se confond pas", async () => {
    const premier = await unProjet();
    const second = await unProjet();
    await verrouillerChamp({ type: "projet_acquereur", id: premier.id }, "budgetMax", WORKSPACE_TEST);

    expect(await champEstVerrouille({ type: "projet_acquereur", id: second.id }, "budgetMax")).toBe(false);
    expect(await listerChampsVerrouilles({ type: "projet_acquereur", id: second.id })).toEqual([]);
  });
});

describe("ADR-056 — le cas 450 000 / 470 000, joué de bout en bout", () => {
  it("import, correction humaine, puis pull suivant : la valeur humaine survit", async () => {
    // 1. Import initial : le fournisseur propose 450 000 sur un champ libre.
    const projet = await unProjet();
    const cible = { type: "projet_acquereur" as const, id: projet.id };
    expect(await champEstVerrouille(cible, "budgetMax")).toBe(false);
    expect(
      deciderApplicationValeurExterne({
        valeurLocale: undefined,
        valeurExterne: 450_000,
        champVerrouille: await champEstVerrouille(cible, "budgetMax"),
        sourceDeVerite: "externe",
      })
    ).toBe("appliquer");

    // 2. Correction humaine : 470 000, et le champ est verrouillé par ce geste.
    await verrouillerChamp(cible, "budgetMax", WORKSPACE_TEST);

    // 3. Pull suivant : le connecteur propose de nouveau 450 000.
    const decision = deciderApplicationValeurExterne({
      valeurLocale: 470_000,
      valeurExterne: 450_000,
      champVerrouille: await champEstVerrouille(cible, "budgetMax"),
      sourceDeVerite: "externe",
    });

    // AUCUNE écriture, et le désaccord est un fait constaté — jamais résolu en silence.
    expect(decision).toBe("conflit");

    // Le verrou tient tant qu'un humain ne l'a pas levé : rejouer le pull ne l'use pas.
    expect(await champEstVerrouille(cible, "budgetMax")).toBe(true);
  });
});
