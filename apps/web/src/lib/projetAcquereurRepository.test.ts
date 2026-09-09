import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ADR-055 §B — test d'intégration Postgres : ce qui compte ici (FK réelles, UNIQUE composite,
// CHECK de rôle, appartenance NOT NULL sans DEFAULT) n'existe qu'en base. Un mock ne prouverait
// rien de ce que ce lot promet.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("./contactRepository");
const {
  ajouterPartieProjet,
  creerProjetAcquereur,
  getProjetAcquereurById,
  listerPartiesDuContact,
  listerPartiesDuProjet,
} = await import("./projetAcquereurRepository");

const PROJET_MINIMAL = {
  budgetMin: 200_000,
  budgetMax: 320_000,
  criteres: ["jardin"],
  stadeProjet: "decouverte" as const,
};

const projetsCrees: string[] = [];
const contactsCrees: string[] = [];
const workspacesCrees: string[] = [];

async function unContact(nom: string, workspaceId: string = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `[test réel] ${nom}` }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unProjet(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetAcquereur(PROJET_MINIMAL, workspaceId);
  projetsCrees.push(projet.id);
  return projet;
}

afterAll(async () => {
  // Ordre imposé par les FK : les parties tombent avec leur projet (CASCADE), les contacts ne sont
  // supprimables qu'ensuite.
  if (projetsCrees.length > 0) {
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("projetAcquereurRepository — le projet (intégration Postgres)", () => {
  it("crée un projet et le relit par son identifiant", async () => {
    const projet = await unProjet();

    const relu = await getProjetAcquereurById(projet.id);
    expect(relu).toBeDefined();
    expect(relu!.budgetMin).toBe(200_000);
    expect(relu!.budgetMax).toBe(320_000);
    expect(relu!.criteres).toEqual(["jardin"]);
    expect(relu!.stadeProjet).toBe("decouverte");
    // Critères non documentés : absents, jamais `false` (ADR-009).
    expect(relu!.necessiteParking).toBeUndefined();
    expect(relu!.archiveLe).toBeUndefined();
  });

  it("écrit explicitement le workspace reçu, et refuse un workspace inexistant", async () => {
    const projet = await unProjet();
    const [ligne] = await getDb()
      .select({ workspaceId: projetsAcquereurTable.workspaceId })
      .from(projetsAcquereurTable)
      .where(eq(projetsAcquereurTable.id, projet.id));
    expect(ligne.workspaceId).toBe(WORKSPACE_TEST);

    await expect(creerProjetAcquereur(PROJET_MINIMAL, "workspace-qui-n-existe-pas")).rejects.toThrow();
  });

  it("retourne undefined pour un identifiant inconnu ou non-UUID, sans erreur de cast", async () => {
    expect(await getProjetAcquereurById("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    expect(await getProjetAcquereurById("projet-001")).toBeUndefined();
  });
});

describe("parties_projet — la relation contact ↔ projet est réellement N:N", () => {
  it("rattache un contact à un projet, avec son rôle porté par la relation", async () => {
    const contact = await unContact("Solo");
    const projet = await unProjet();

    const partie = await ajouterPartieProjet({
      contactId: contact.id,
      projetAcquereurId: projet.id,
      role: "acquereur",
    });

    expect(partie.role).toBe("acquereur");
    expect(await listerPartiesDuProjet(projet.id)).toHaveLength(1);
  });

  it("un même projet porté par DEUX contacts — couple, coacquéreurs, indivision", async () => {
    // Le cas que `acquereurs` ne sait pas représenter : une seule ligne, une seule identité. Ici
    // les deux personnes existent, distinctes, et aucune n'est l'attribut de l'autre.
    const premier = await unContact("Couple A");
    const second = await unContact("Couple B");
    const projet = await unProjet();

    await ajouterPartieProjet({ contactId: premier.id, projetAcquereurId: projet.id, role: "acquereur" });
    await ajouterPartieProjet({ contactId: second.id, projetAcquereurId: projet.id, role: "co_acquereur" });

    const parties = await listerPartiesDuProjet(projet.id);
    expect(parties).toHaveLength(2);
    expect(parties.map((partie) => partie.role).sort()).toEqual(["acquereur", "co_acquereur"]);
    expect(new Set(parties.map((partie) => partie.contactId)).size).toBe(2);
  });

  it("un même contact porte DEUX projets distincts — jamais fusionnés parce que la personne est la même", async () => {
    // Recherches successives ou parallèles : chacune a sa propre intention, son propre budget, sa
    // propre histoire. Les fusionner effacerait l'une des deux.
    const contact = await unContact("Multi-projets");
    const premier = await unProjet();
    const second = await unProjet();

    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: premier.id, role: "acquereur" });
    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: second.id, role: "acquereur" });

    const parties = await listerPartiesDuContact(contact.id);
    expect(parties).toHaveLength(2);
    expect(new Set(parties.map((partie) => partie.projetAcquereurId)).size).toBe(2);
  });

  it("refuse une participation en double au même projet", async () => {
    // Changer le rôle de quelqu'un est une mise à jour, jamais une seconde ligne : sinon le projet
    // porterait deux vérités sur la même personne.
    const contact = await unContact("Doublon");
    const projet = await unProjet();

    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projet.id, role: "acquereur" });
    await expect(
      ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projet.id, role: "co_acquereur" })
    ).rejects.toThrow();
  });

  it("refuse une participation qui traverserait deux workspaces", async () => {
    // `parties_projet` est une feuille sans `workspace_id` (ADR-054 §7) : la base ne peut pas
    // refuser cette relation, c'est le chemin applicatif qui le fait. Relier deux périmètres serait
    // une fuite entre deux conseillers, pas une donnée approximative — donc une erreur, jamais un
    // silence.
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-parties-projet", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);

    const contactAilleurs = await unContact("Ailleurs", autreWorkspace.id);
    const projetIci = await unProjet();

    await expect(
      ajouterPartieProjet({ contactId: contactAilleurs.id, projetAcquereurId: projetIci.id, role: "acquereur" })
    ).rejects.toThrow(/workspaces différents/);

    expect(await listerPartiesDuProjet(projetIci.id)).toEqual([]);
  });

  it("refuse un contact ou un projet inexistant plutôt que d'écrire une relation orpheline", async () => {
    const projet = await unProjet();
    const contact = await unContact("Orphelin");
    const inexistant = "00000000-0000-0000-0000-000000000000";

    await expect(
      ajouterPartieProjet({ contactId: inexistant, projetAcquereurId: projet.id, role: "acquereur" })
    ).rejects.toThrow(/Contact introuvable/);
    await expect(
      ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: inexistant, role: "acquereur" })
    ).rejects.toThrow(/Projet acquéreur introuvable/);
  });

  it("un projet peut exister sans aucune partie", async () => {
    // Décision assumée : aucune contrainte n'impose au moins un porteur. Un projet est créé avant
    // que ses parties le soient (elles le référencent), et l'exiger obligerait à un ordre d'écriture
    // que la base ne peut pas garantir. L'invariant « un projet finit par avoir un porteur » est
    // tenu par le flux de création, pas par le schéma.
    const projet = await unProjet();
    expect(await listerPartiesDuProjet(projet.id)).toEqual([]);
  });
});
