import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

// ADR-055 §G — test d'intégration Postgres : le vocabulaire fermé, le CHECK « au plus un
// contexte » et la FK obligatoire vers `contacts` n'existent qu'en base.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  projetsAcquereur: projetsAcquereurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("./contactRepository");
const { creerProjetAcquereur } = await import("./projetAcquereurRepository");
const { creerBien } = await import("./bienRepository");
const { creerInteraction, getInteractionById, listerInteractionsDuContact } = await import(
  "./interactionRepository"
);

const contactsCrees: string[] = [];
const projetsCrees: string[] = [];
const biensCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unContact(nom: string, workspaceId: string = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `[test réel] ${nom}` }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unProjetAcquereur(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 200_000, criteres: [], stadeProjet: "decouverte" },
    workspaceId
  );
  projetsCrees.push(projet.id);
  return projet;
}

async function unBien(workspaceId: string = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] INTERACTION-${compteur}-${Date.now()}`,
      titre: "Bien de test interaction",
      type: "appartement",
      adresse: "1 rue de l'Échange",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  biensCrees.push(bien.id);
  return bien;
}

afterAll(async () => {
  if (contactsCrees.length > 0) {
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, contactsCrees));
  }
  if (projetsCrees.length > 0) {
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (biensCrees.length > 0) {
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("interactionRepository — l'interaction (intégration Postgres)", () => {
  it("crée une interaction sans contexte et la relit", async () => {
    // Un appel de courtoisie sans dossier reste un fait relationnel complet.
    const contact = await unContact("Appel simple");
    const interaction = await creerInteraction({
      contactId: contact.id,
      type: "appel",
      sens: "sortant",
      survenuLe: "2026-05-04T10:00:00.000Z",
      contenu: "Point rapide sur sa recherche.",
    });

    const relu = await getInteractionById(interaction.id);
    expect(relu).toBeDefined();
    expect(relu!.type).toBe("appel");
    expect(relu!.sens).toBe("sortant");
    expect(relu!.contenu).toBe("Point rapide sur sa recherche.");
    expect(relu!.survenuLe).toBe("2026-05-04T10:00:00.000Z");
    // Aucun contexte : absents, jamais `null`.
    expect(relu!.projetAcquereurId).toBeUndefined();
    expect(relu!.projetVendeurId).toBeUndefined();
    expect(relu!.bienId).toBeUndefined();
  });

  it("un rendez-vous n'a pas de sens, et ce n'est pas une donnée manquante", async () => {
    const contact = await unContact("Rendez-vous");
    const interaction = await creerInteraction({
      contactId: contact.id,
      type: "rendez_vous",
      survenuLe: "2026-05-05T09:00:00.000Z",
    });
    expect(interaction.sens).toBeUndefined();
    expect(interaction.contenu).toBeUndefined();
  });

  it("la date métier ne retombe jamais sur la date d'enregistrement", async () => {
    // Le cas d'un import : un échange vieux de plusieurs mois garde SA date.
    const contact = await unContact("Import ancien");
    const interaction = await creerInteraction({
      contactId: contact.id,
      type: "email",
      sens: "entrant",
      survenuLe: "2025-11-02T08:30:00.000Z",
    });
    expect(interaction.survenuLe).toBe("2025-11-02T08:30:00.000Z");
    expect(interaction.creeLe).not.toBe(interaction.survenuLe);
    expect(new Date(interaction.creeLe).getTime()).toBeGreaterThan(new Date(interaction.survenuLe).getTime());
  });

  it("refuse un contact inexistant plutôt qu'une interaction orpheline", async () => {
    await expect(
      creerInteraction({
        contactId: "00000000-0000-0000-0000-000000000000",
        type: "note",
        survenuLe: "2026-05-04T10:00:00.000Z",
      })
    ).rejects.toThrow(/Contact introuvable/);
  });

  it("retourne undefined pour un identifiant inconnu ou non-UUID, sans erreur de cast", async () => {
    expect(await getInteractionById("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    expect(await getInteractionById("interaction-001")).toBeUndefined();
  });

  it("refuse un type hors du vocabulaire — une visite ne devient pas une interaction en se renommant", async () => {
    const contact = await unContact("Type interdit");
    for (const type of ["visite", "mandat_signe", "offre_acceptee"]) {
      await expect(
        getDb()
          .insert(interactionsTable)
          .values({ contactId: contact.id, type, survenuLe: new Date("2026-05-04T10:00:00.000Z") })
      ).rejects.toThrow();
    }
  });

  it("refuse un sens hors du vocabulaire", async () => {
    const contact = await unContact("Sens interdit");
    await expect(
      getDb()
        .insert(interactionsTable)
        .values({
          contactId: contact.id,
          type: "appel",
          sens: "bidirectionnel",
          survenuLe: new Date("2026-05-04T10:00:00.000Z"),
        })
    ).rejects.toThrow();
  });
});

describe("ADR-055 §G — contexte optionnel, au plus un", () => {
  it("rattache une interaction à un projet acquéreur, ou à un bien", async () => {
    const contact = await unContact("Avec contexte");
    const projet = await unProjetAcquereur();
    const bien = await unBien();

    const surProjet = await creerInteraction({
      contactId: contact.id,
      type: "email",
      sens: "sortant",
      survenuLe: "2026-05-04T10:00:00.000Z",
      projetAcquereurId: projet.id,
    });
    expect(surProjet.projetAcquereurId).toBe(projet.id);
    expect(surProjet.bienId).toBeUndefined();

    const surBien = await creerInteraction({
      contactId: contact.id,
      type: "message",
      sens: "entrant",
      survenuLe: "2026-05-05T10:00:00.000Z",
      bienId: bien.id,
    });
    expect(surBien.bienId).toBe(bien.id);
    expect(surBien.projetAcquereurId).toBeUndefined();
  });

  it("refuse DEUX contextes à la fois — le CHECK, pas une convention", async () => {
    // Le type l'interdit déjà ; ce test prouve que la base le refuse aussi, parce qu'un jour une
    // écriture contournera le repository.
    const contact = await unContact("Deux contextes");
    const projet = await unProjetAcquereur();
    const bien = await unBien();

    await expect(
      getDb().insert(interactionsTable).values({
        contactId: contact.id,
        type: "appel",
        survenuLe: new Date("2026-05-04T10:00:00.000Z"),
        projetAcquereurId: projet.id,
        bienId: bien.id,
      })
    ).rejects.toThrow();
  });

  it("refuse un contexte inexistant", async () => {
    const contact = await unContact("Contexte fantôme");
    await expect(
      creerInteraction({
        contactId: contact.id,
        type: "appel",
        survenuLe: "2026-05-04T10:00:00.000Z",
        bienId: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow(/Contexte introuvable/);
  });

  it("refuse un contexte appartenant à un autre workspace", async () => {
    // `interactions` est une feuille sans `workspace_id` : la base ne peut pas refuser cette
    // relation. Même garde et même raison que `ajouterPartieProjet` et `creerMandat`.
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-interaction", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);

    const contactIci = await unContact("Contact ici");
    const bienAilleurs = await unBien(autreWorkspace.id);

    await expect(
      creerInteraction({
        contactId: contactIci.id,
        type: "appel",
        survenuLe: "2026-05-04T10:00:00.000Z",
        bienId: bienAilleurs.id,
      })
    ).rejects.toThrow(/workspaces différents/);
    expect(await listerInteractionsDuContact(contactIci.id)).toEqual([]);
  });
});

describe("ADR-055 §G — la chronologie d'un contact est totalement déterministe", () => {
  it("liste du plus récent au plus ancien, sur la date métier", async () => {
    const contact = await unContact("Chronologie");
    const ancienne = await creerInteraction({
      contactId: contact.id,
      type: "appel",
      survenuLe: "2026-01-01T10:00:00.000Z",
    });
    const recente = await creerInteraction({
      contactId: contact.id,
      type: "email",
      survenuLe: "2026-06-01T10:00:00.000Z",
    });
    const intermediaire = await creerInteraction({
      contactId: contact.id,
      type: "sms",
      survenuLe: "2026-03-01T10:00:00.000Z",
    });

    const chronologie = await listerInteractionsDuContact(contact.id);
    expect(chronologie.map((interaction) => interaction.id)).toEqual([recente.id, intermediaire.id, ancienne.id]);
  });

  it("départage deux interactions de MÊME date métier sans jamais dépendre du plan d'exécution", async () => {
    // Deux échanges à la même seconde (import, saisie en lot) : sans départage explicite, l'ordre
    // rendu changerait d'une exécution à l'autre. Deux lectures successives doivent être identiques.
    const contact = await unContact("Ex aequo");
    const instant = "2026-04-01T12:00:00.000Z";
    for (const type of ["appel", "email", "sms", "note"] as const) {
      await creerInteraction({ contactId: contact.id, type, survenuLe: instant });
    }

    const premiere = await listerInteractionsDuContact(contact.id);
    const seconde = await listerInteractionsDuContact(contact.id);
    expect(premiere).toHaveLength(4);
    expect(premiere.map((interaction) => interaction.id)).toEqual(seconde.map((interaction) => interaction.id));
  });

  it("la chronologie d'un contact ne contient jamais celle d'un autre", async () => {
    const premier = await unContact("Isolé A");
    const second = await unContact("Isolé B");
    await creerInteraction({ contactId: premier.id, type: "appel", survenuLe: "2026-05-04T10:00:00.000Z" });
    await creerInteraction({ contactId: second.id, type: "note", survenuLe: "2026-05-04T11:00:00.000Z" });

    const chronoPremier = await listerInteractionsDuContact(premier.id);
    expect(chronoPremier).toHaveLength(1);
    expect(chronoPremier[0].contactId).toBe(premier.id);
    expect(await listerInteractionsDuContact("pas-un-uuid")).toEqual([]);
  });
});
