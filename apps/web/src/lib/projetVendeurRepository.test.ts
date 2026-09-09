import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ADR-055 §B — test d'intégration Postgres : les FK réelles, le CHECK « exactement une cible »,
// les deux UNIQUE composites et l'appartenance NOT NULL sans DEFAULT n'existent qu'en base.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("./contactRepository");
const { creerProjetAcquereur } = await import("./projetAcquereurRepository");
const { creerProjetVendeur, getProjetVendeurById } = await import("./projetVendeurRepository");
const { ajouterPartieProjet, listerPartiesDuContact, listerPartiesDuProjetVendeur } = await import(
  "./partieProjetRepository"
);

const projetsVendeurCrees: string[] = [];
const projetsAcquereurCrees: string[] = [];
const contactsCrees: string[] = [];
const workspacesCrees: string[] = [];

async function unContact(nom: string, workspaceId: string = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `[test réel] ${nom}` }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unProjetVendeur(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetVendeur({ origineLead: "recommandation" }, workspaceId);
  projetsVendeurCrees.push(projet.id);
  return projet;
}

async function unProjetAcquereur(workspaceId: string = WORKSPACE_TEST) {
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 200_000, criteres: [], stadeProjet: "decouverte" },
    workspaceId
  );
  projetsAcquereurCrees.push(projet.id);
  return projet;
}

afterAll(async () => {
  // Ordre imposé par les FK : les parties tombent avec leur projet (CASCADE), les contacts ensuite.
  if (projetsVendeurCrees.length > 0) {
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, projetsVendeurCrees));
  }
  if (projetsAcquereurCrees.length > 0) {
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, projetsAcquereurCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
  if (workspacesCrees.length > 0) {
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
  }
});

describe("projetVendeurRepository — le projet de vente (intégration Postgres)", () => {
  it("crée un projet et le relit par son identifiant", async () => {
    const projet = await unProjetVendeur();

    const relu = await getProjetVendeurById(projet.id);
    expect(relu).toBeDefined();
    expect(relu!.origineLead).toBe("recommandation");
    // Aucun jalon n'est posé à la création (ADR-027) : ils sont absents, jamais à une date nulle.
    expect(relu!.qualifieLe).toBeUndefined();
    expect(relu!.mandatSigneLe).toBeUndefined();
    expect(relu!.datePerte).toBeUndefined();
    expect(relu!.archiveLe).toBeUndefined();
  });

  it("écrit explicitement le workspace reçu, et refuse un workspace inexistant", async () => {
    const projet = await unProjetVendeur();
    const [ligne] = await getDb()
      .select({ workspaceId: projetsVendeurTable.workspaceId })
      .from(projetsVendeurTable)
      .where(eq(projetsVendeurTable.id, projet.id));
    expect(ligne.workspaceId).toBe(WORKSPACE_TEST);

    await expect(creerProjetVendeur({ origineLead: "panneau" }, "workspace-qui-n-existe-pas")).rejects.toThrow();
  });

  it("retourne undefined pour un identifiant inconnu ou non-UUID, sans erreur de cast", async () => {
    expect(await getProjetVendeurById("00000000-0000-0000-0000-000000000000")).toBeUndefined();
    expect(await getProjetVendeurById("projet-vendeur-001")).toBeUndefined();
  });
});

describe("parties_projet — le côté vendeur est aussi réellement N:N", () => {
  it("rattache un contact à un projet vendeur, avec son rôle porté par la relation", async () => {
    const contact = await unContact("Vendeur solo");
    const projet = await unProjetVendeur();

    const partie = await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projet.id, role: "vendeur" });

    expect(partie.role).toBe("vendeur");
    expect(partie.projetVendeurId).toBe(projet.id);
    // Une seule cible : le côté acquéreur est absent, jamais `null`.
    expect(partie.projetAcquereurId).toBeUndefined();
    expect(await listerPartiesDuProjetVendeur(projet.id)).toHaveLength(1);
  });

  it("un même projet vendu par DEUX contacts — couple, indivision, succession", async () => {
    // Le cas qu'ADR-027 §1 déclare hors de portée du modèle historique (« un seul contact principal
    // par opportunité »). C'est exactement la limite que ce modèle lève.
    const premier = await unContact("Indivision A");
    const second = await unContact("Indivision B");
    const projet = await unProjetVendeur();

    await ajouterPartieProjet({ contactId: premier.id, projetVendeurId: projet.id, role: "vendeur" });
    await ajouterPartieProjet({ contactId: second.id, projetVendeurId: projet.id, role: "co_vendeur" });

    const parties = await listerPartiesDuProjetVendeur(projet.id);
    expect(parties).toHaveLength(2);
    expect(parties.map((partie) => partie.role).sort()).toEqual(["co_vendeur", "vendeur"]);
  });

  it("un même contact vend DEUX fois au cours du temps — projets successifs, jamais fusionnés", async () => {
    const contact = await unContact("Vendeur récurrent");
    const premier = await unProjetVendeur();
    const second = await unProjetVendeur();

    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: premier.id, role: "vendeur" });
    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: second.id, role: "vendeur" });

    const parties = await listerPartiesDuContact(contact.id);
    expect(parties).toHaveLength(2);
    expect(new Set(parties.map((partie) => partie.projetVendeurId)).size).toBe(2);
  });

  it("UN MÊME CONTACT est vendeur ici et acquéreur ailleurs, simultanément", async () => {
    // L'invariant fondateur du modèle canonique (CAS 8 d'ADR-055) : le rôle n'est pas une propriété
    // de la personne. Le même humain vend son appartement et en cherche un autre — deux
    // participations, deux projets, une seule identité. Aucune colonne ne l'affirme, et c'est
    // précisément pour ça que c'est exprimable.
    const contact = await unContact("Vendeur et acquéreur");
    const projetVendeur = await unProjetVendeur();
    const projetAcquereur = await unProjetAcquereur();

    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projetVendeur.id, role: "vendeur" });
    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projetAcquereur.id, role: "acquereur" });

    const parties = await listerPartiesDuContact(contact.id);
    expect(parties).toHaveLength(2);
    expect(parties.map((partie) => partie.role).sort()).toEqual(["acquereur", "vendeur"]);
    // Chaque partie ne vise qu'un seul projet — l'autre côté reste vide.
    for (const partie of parties) {
      expect([partie.projetAcquereurId, partie.projetVendeurId].filter(Boolean)).toHaveLength(1);
    }
  });

  it("refuse une participation en double au même projet vendeur", async () => {
    const contact = await unContact("Doublon vendeur");
    const projet = await unProjetVendeur();

    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projet.id, role: "vendeur" });
    await expect(
      ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projet.id, role: "co_vendeur" })
    ).rejects.toThrow();
  });

  it("refuse une participation qui traverserait deux workspaces", async () => {
    // Même garde applicative que côté acquéreur, et la MÊME implémentation : `parties_projet` est
    // une feuille sans `workspace_id` (ADR-054 §7), donc la base ne peut pas refuser cette relation.
    const [autreWorkspace] = await getDb()
      .insert(workspacesTable)
      .values({ id: "workspace-test-projet-vendeur", nom: "[test réel] autre workspace" })
      .returning();
    workspacesCrees.push(autreWorkspace.id);

    const contactAilleurs = await unContact("Vendeur ailleurs", autreWorkspace.id);
    const projetIci = await unProjetVendeur();

    await expect(
      ajouterPartieProjet({ contactId: contactAilleurs.id, projetVendeurId: projetIci.id, role: "vendeur" })
    ).rejects.toThrow(/workspaces différents/);

    expect(await listerPartiesDuProjetVendeur(projetIci.id)).toEqual([]);
  });

  it("refuse un projet vendeur inexistant plutôt que d'écrire une relation orpheline", async () => {
    const contact = await unContact("Orphelin vendeur");
    await expect(
      ajouterPartieProjet({
        contactId: contact.id,
        projetVendeurId: "00000000-0000-0000-0000-000000000000",
        role: "vendeur",
      })
    ).rejects.toThrow(/Projet introuvable/);
  });

  it("refuse une partie sans aucune cible — le CHECK, pas une convention", async () => {
    // Le type interdit déjà d'omettre les deux cibles ; ce test prouve que la BASE le refuse aussi,
    // parce qu'un jour une écriture contournera le repository.
    const contact = await unContact("Sans cible");
    await expect(
      getDb().insert(partiesProjetTable).values({ contactId: contact.id, role: "vendeur" })
    ).rejects.toThrow();
  });

  it("refuse une partie visant DEUX projets à la fois", async () => {
    // Une même participation ne peut pas être à la fois un achat et une vente.
    const contact = await unContact("Deux cibles");
    const projetVendeur = await unProjetVendeur();
    const projetAcquereur = await unProjetAcquereur();

    await expect(
      getDb().insert(partiesProjetTable).values({
        contactId: contact.id,
        projetVendeurId: projetVendeur.id,
        projetAcquereurId: projetAcquereur.id,
        role: "vendeur",
      })
    ).rejects.toThrow();
  });

  it("un projet vendeur peut exister sans aucune partie", async () => {
    // Même décision assumée que côté acquéreur : le projet est écrit avant ses parties (elles le
    // référencent), donc le schéma ne peut pas exiger un porteur. L'invariant est tenu par le flux.
    const projet = await unProjetVendeur();
    expect(await listerPartiesDuProjetVendeur(projet.id)).toEqual([]);
  });
});
