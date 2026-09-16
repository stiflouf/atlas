import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §H — « Créer un contact depuis ce dossier » est UNE transaction : le dossier est relu et
// verrouillé dans le workspace, le contact est créé à son image, le dossier est rattaché — ou rien
// n'est écrit. Aucun contact orphelin ne subsiste, quel que soit le refus ou l'échec, et deux
// soumissions concurrentes n'en créent qu'un.
const { pannes } = vi.hoisted(() => ({
  pannes: { partieProjet: false, contactActif: false },
}));
vi.mock("@/lib/partieProjetRepository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/partieProjetRepository")>();
  return {
    ...original,
    ajouterPartieProjet: async (...args: Parameters<typeof original.ajouterPartieProjet>) => {
      if (pannes.partieProjet) throw new Error("panne simulée après création du contact");
      return original.ajouterPartieProjet(...args);
    },
  };
});
vi.mock("@/lib/contactActif", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contactActif")>();
  return {
    ...original,
    verrouillerContactActif: async (...args: Parameters<typeof original.verrouillerContactActif>) => {
      if (pannes.contactActif) return { statut: "fusionne" as const };
      return original.verrouillerContactActif(...args);
    },
  };
});

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerContactEtRattacherAcquereur, creerContactEtRattacherProspectVendeur } = await import("@/lib/rattachementContact");

const M = `Zatomicite${Date.now()}`;
let compteur = 0;
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsProjetsA: string[] = [];
const idsWorkspaces: string[] = [];

beforeEach(() => {
  pannes.partieProjet = false;
  pannes.contactActif = false;
});

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsProjetsA.length > 0) {
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.projetAcquereurId, idsProjetsA));
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  }
  await getDb().delete(contactsTable).where(like(contactsTable.nom, `${M}%`));
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

// Chaque dossier porte un nom UNIQUE : compter les contacts qui le portent, c'est compter ce que
// « créer depuis ce dossier » a réellement persisté.
async function unAcquereur(projetAcquereurId?: string, workspace = WORKSPACE_TEST) {
  const nom = `${M} Acq ${++compteur}`;
  const dossier = await creerAcquereur(
    { prenom: "Bob", nom, email: `${M}.${compteur}@example.test`, telephone: "0600000000", budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "decouverte", notes: "", datePremiereContact: "2026-01-01", projetAcquereurId },
    workspace
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unProspect(workspace = WORKSPACE_TEST) {
  const nom = `${M} Pro ${++compteur}`;
  const prospect = await creerProspectVendeur(
    { nom, prenom: "Bob", email: `${M}.${compteur}@example.test`, telephone: undefined, origineLead: undefined, origineLeadDetail: undefined, adresseBienPotentiel: undefined, secteurBienPotentiel: undefined, ville: undefined, codePostal: undefined, typeBien: undefined },
    workspace
  );
  idsProspects.push(prospect.id);
  return prospect;
}

const contactsPortant = (nom: string) => getDb().select().from(contactsTable).where(eq(contactsTable.nom, nom));
const ligneAcq = async (id: string) => (await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id)))[0]!;
const lignePro = async (id: string) => (await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id)))[0]!;

describe("créer un contact depuis un dossier — atomicité", () => {
  it("A. acquéreur : un contact à l'image du dossier (relu en base), rattaché, dans le workspace", async () => {
    const dossier = await unAcquereur();
    const resultat = await creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("rattache");
    if (resultat.statut !== "rattache") return;
    const contacts = await contactsPortant(dossier.nom);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ id: resultat.contact.id, workspaceId: WORKSPACE_TEST, prenom: "Bob", email: dossier.email, telephone: "0600000000" });
    expect((await ligneAcq(dossier.id)).contactId).toBe(resultat.contact.id);
  });

  it("B. vendeur : même garantie ; une chaîne vide historique devient une absence", async () => {
    const prospect = await unProspect();
    await getDb().update(prospectsVendeursTable).set({ prenom: "" }).where(eq(prospectsVendeursTable.id, prospect.id));
    const resultat = await creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("rattache");
    if (resultat.statut !== "rattache") return;
    const contacts = await contactsPortant(prospect.nom);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].prenom).toBeNull();
    expect((await lignePro(prospect.id)).contactId).toBe(resultat.contact.id);
  });

  it("C. dossier déjà rattaché : deja_rattache, aucun nouveau contact", async () => {
    const dossier = await unAcquereur();
    const premier = await creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST);
    expect(premier.statut).toBe("rattache");
    const second = await creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST);
    expect(second).toEqual({ statut: "deja_rattache", contactId: premier.statut === "rattache" ? premier.contact.id : "?" });
    expect(await contactsPortant(dossier.nom)).toHaveLength(1);

    const prospect = await unProspect();
    const p1 = await creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST);
    const p2 = await creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST);
    expect(p1.statut).toBe("rattache");
    expect(p2.statut).toBe("deja_rattache");
    expect(await contactsPortant(prospect.nom)).toHaveLength(1);
  });

  it("D. dossier introuvable ou id invalide : dossier_introuvable, aucun contact", async () => {
    const avant = (await getDb().select().from(contactsTable).where(like(contactsTable.nom, `${M}%`))).length;
    expect(await creerContactEtRattacherAcquereur("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toEqual({ statut: "dossier_introuvable" });
    expect(await creerContactEtRattacherAcquereur("pas-un-uuid", WORKSPACE_TEST)).toEqual({ statut: "dossier_introuvable" });
    expect(await creerContactEtRattacherProspectVendeur("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toEqual({ statut: "dossier_introuvable" });
    expect((await getDb().select().from(contactsTable).where(like(contactsTable.nom, `${M}%`))).length).toBe(avant);
  });

  it("E. dossier d'un AUTRE workspace : introuvable, rien copié dans le workspace courant, rien changé là-bas", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre atomicité" });
    idsWorkspaces.push(autre);
    const dossier = await unAcquereur(undefined, autre);
    const prospect = await unProspect(autre);

    expect(await creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST)).toEqual({ statut: "dossier_introuvable" });
    expect(await creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST)).toEqual({ statut: "dossier_introuvable" });
    expect(await contactsPortant(dossier.nom)).toHaveLength(0);
    expect(await contactsPortant(prospect.nom)).toHaveLength(0);
    expect((await ligneAcq(dossier.id)).contactId).toBeNull();
    expect((await lignePro(prospect.id)).contactId).toBeNull();
  });

  it("F. échec APRÈS la création du contact (panne sur la partie de projet) : rollback, contact absent, dossier intact", async () => {
    const projet = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "decouverte" }, WORKSPACE_TEST);
    idsProjetsA.push(projet.id);
    const dossier = await unAcquereur(projet.id);
    pannes.partieProjet = true;
    await expect(creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST)).rejects.toThrow("panne simulée");
    expect(await contactsPortant(dossier.nom)).toHaveLength(0);
    expect((await ligneAcq(dossier.id)).contactId).toBeNull();
    expect(await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.projetAcquereurId, projet.id))).toHaveLength(0);
    // Sans la panne, le même dossier se rattache normalement.
    pannes.partieProjet = false;
    const resultat = await creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST);
    expect(resultat).toMatchObject({ statut: "rattache", partieCreee: true });
  });

  it("G. refus APRÈS la création du contact (garde contact actif incohérente) : rollback, contact absent", async () => {
    const dossier = await unAcquereur();
    const prospect = await unProspect();
    pannes.contactActif = true;
    await expect(creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST)).rejects.toThrow("Rattachement incohérent");
    await expect(creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST)).rejects.toThrow("Rattachement incohérent");
    expect(await contactsPortant(dossier.nom)).toHaveLength(0);
    expect(await contactsPortant(prospect.nom)).toHaveLength(0);
    expect((await ligneAcq(dossier.id)).contactId).toBeNull();
    expect((await lignePro(prospect.id)).contactId).toBeNull();
  });

  it("H. double soumission acquéreur CONCURRENTE : un seul contact, rattaché ; l'autre voit deja_rattache", async () => {
    const dossier = await unAcquereur();
    const [a, b] = await Promise.all([
      creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST),
      creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["deja_rattache", "rattache"]);
    const contacts = await contactsPortant(dossier.nom);
    expect(contacts).toHaveLength(1);
    expect((await ligneAcq(dossier.id)).contactId).toBe(contacts[0].id);
    const gagnant = [a, b].find((r) => r.statut === "rattache");
    const perdant = [a, b].find((r) => r.statut === "deja_rattache");
    if (gagnant?.statut === "rattache" && perdant?.statut === "deja_rattache") expect(perdant.contactId).toBe(gagnant.contact.id);
  });

  it("I. double soumission vendeur CONCURRENTE : un seul contact, rattaché", async () => {
    const prospect = await unProspect();
    const [a, b] = await Promise.all([
      creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST),
      creerContactEtRattacherProspectVendeur(prospect.id, WORKSPACE_TEST),
    ]);
    expect([a.statut, b.statut].sort()).toEqual(["deja_rattache", "rattache"]);
    const contacts = await contactsPortant(prospect.nom);
    expect(contacts).toHaveLength(1);
    expect((await lignePro(prospect.id)).contactId).toBe(contacts[0].id);
  });

  it("J. dans la transaction d'un appelant : un refus n'annule que le savepoint, le contact reste absent", async () => {
    const dossier = await unAcquereur();
    const premier = await creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST);
    expect(premier.statut).toBe("rattache");
    const second = await getDb().transaction((tx) => creerContactEtRattacherAcquereur(dossier.id, WORKSPACE_TEST, tx));
    expect(second.statut).toBe("deja_rattache");
    expect(await contactsPortant(dossier.nom)).toHaveLength(1);
  });
});
