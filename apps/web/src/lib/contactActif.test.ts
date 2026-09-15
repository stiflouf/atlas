import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-059 §10 — UN CONTACT ABSORBÉ EST FIGÉ. Ces tests fixent la garde partagée, puis la matrice
// de chaque writer métier recevant un contact_id (actif → OK ; absorbé → refus ; inconnu ou autre
// workspace → introuvable, indistinguables ; aucune ligne écrite sur refus ; jamais réécrit vers
// le survivant), et enfin la CONCURRENCE avec le moteur de fusion : quel que soit l'ordre, aucune
// donnée vivante ne reste sur un absorbé.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  prospectsVendeurs: prospectsVendeursTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { ErreurContactFusionne, exigerContactActif, verrouillerContactActif } = await import("@/lib/contactActif");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { enregistrerReferenceExterne } = await import("@/lib/provenance/referenceExterneRepository");
const { verrouillerChamp } = await import("@/lib/provenance/champVerrouilleRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");

const M = `Zactif${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;
const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    const interactionsDuLot = (
      await getDb().select({ id: interactionsTable.id }).from(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts))
    ).map((i) => i.id);
    if (interactionsDuLot.length > 0)
      await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.interactionId, interactionsDuLot));
    await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.contactId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
    await getDb().delete(acquereursTable).where(inArray(acquereursTable.contactId, idsContacts));
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.contactId, idsContacts));
  }
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0) await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0) await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(surcharge: { nom?: string; email?: string } = {}, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjet() {
  const projet = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active" }, WORKSPACE_TEST);
  idsProjetsA.push(projet.id);
  return projet;
}

// Absorbé par le VRAI moteur, pas par un UPDATE de test : c'est l'état réel qu'un writer rencontre.
async function absorber(absorbe: Contact, survivant: Contact) {
  const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });
  const resultat = await fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: identite(survivant),
    identiteAttendueAbsorbe: identite(absorbe),
    identiteFinale: { nom: survivant.nom, prenom: survivant.prenom, email: survivant.email, telephone: survivant.telephone },
    choixParChamp: {
      nom: survivant.nom === absorbe.nom ? "identique" : "survivant",
      prenom: "identique",
      email: survivant.email === absorbe.email ? "identique" : survivant.email === undefined || absorbe.email === undefined ? "absence_comblee" : "survivant",
      telephone: "identique",
    },
    acteur: { sub: "test" },
  });
  if (resultat.statut !== "fusionne") throw new Error(`fusion attendue, reçu ${resultat.statut}`);
  return resultat;
}

const INCONNU = "00000000-0000-4000-8000-000000000000";

const dossierAcquereur = (contactId?: string) => ({
  prenom: "L",
  nom: `${M} Dossier`,
  email: unEmail(),
  telephone: "0600000000",
  budgetMin: 1,
  budgetMax: 2,
  criteres: [],
  stadeProjet: "recherche_active" as const,
  notes: "",
  datePremiereContact: "2026-01-01",
  contactId,
});

const dossierVendeur = (contactId?: string) => ({
  nom: `${M} Prospect`,
  prenom: undefined,
  email: undefined,
  telephone: undefined,
  origineLead: undefined,
  origineLeadDetail: undefined,
  adresseBienPotentiel: undefined,
  secteurBienPotentiel: undefined,
  ville: undefined,
  codePostal: undefined,
  typeBien: undefined,
  contactId,
});

describe("garde partagée — verrouillerContactActif / exigerContactActif", () => {
  it("actif → contact et workspace ; absorbé → fusionne ; inconnu, id invalide, autre workspace → introuvable", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre garde" });
    idsWorkspaces.push(autre);
    const s = await unContact();
    const a = await unContact();
    const ailleurs = await unContact({}, autre);
    await absorber(a, s);

    await getDb().transaction(async (tx) => {
      expect(await verrouillerContactActif(s.id, tx)).toMatchObject({ statut: "actif", workspaceId: WORKSPACE_TEST, contact: { id: s.id } });
      expect(await verrouillerContactActif(s.id, tx, WORKSPACE_TEST)).toMatchObject({ statut: "actif" });
      expect(await verrouillerContactActif(a.id, tx)).toEqual({ statut: "fusionne" });
      expect(await verrouillerContactActif(INCONNU, tx)).toEqual({ statut: "introuvable" });
      expect(await verrouillerContactActif("pas-un-uuid", tx)).toEqual({ statut: "introuvable" });
      expect(await verrouillerContactActif(ailleurs.id, tx, WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
      // Sans workspace demandé, le workspace réel est rendu : c'est l'appelant qui compare.
      expect(await verrouillerContactActif(ailleurs.id, tx)).toMatchObject({ statut: "actif", workspaceId: autre });

      await expect(exigerContactActif(a.id, tx)).rejects.toBeInstanceOf(ErreurContactFusionne);
      await expect(exigerContactActif(INCONNU, tx)).rejects.toThrow(/Contact introuvable/);
      await expect(exigerContactActif(ailleurs.id, tx, WORKSPACE_TEST)).rejects.toThrow(/Contact introuvable/);
    });
    // La garde ne suit jamais la chaîne : l'absorbé n'est pas « résolu » vers le survivant.
    const [ligne] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, a.id));
    expect(ligne.fusionneDansContactId).toBe(s.id);
  });
});

describe("writers métier — matrice actif / absorbé / introuvable", () => {
  it("creerInteraction", async () => {
    const s = await unContact();
    const a = await unContact();
    await absorber(a, s);
    const ok = await creerInteraction({ contactId: s.id, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" });
    expect(ok.contactId).toBe(s.id);
    await expect(creerInteraction({ contactId: a.id, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" })).rejects.toBeInstanceOf(ErreurContactFusionne);
    await expect(creerInteraction({ contactId: INCONNU, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" })).rejects.toThrow(/Contact introuvable/);
    expect(await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, a.id))).toEqual([]);
    // Jamais réécrit vers le survivant : une seule interaction sur S, celle créée explicitement.
    expect(await getDb().select().from(interactionsTable).where(eq(interactionsTable.contactId, s.id))).toHaveLength(1);
  });

  it("ajouterPartieProjet", async () => {
    const s = await unContact();
    const a = await unContact();
    await absorber(a, s);
    const p = await unProjet();
    const ok = await ajouterPartieProjet({ contactId: s.id, projetAcquereurId: p.id, role: "acquereur" });
    expect(ok.contactId).toBe(s.id);
    const p2 = await unProjet();
    await expect(ajouterPartieProjet({ contactId: a.id, projetAcquereurId: p2.id, role: "acquereur" })).rejects.toBeInstanceOf(ErreurContactFusionne);
    await expect(ajouterPartieProjet({ contactId: INCONNU, projetAcquereurId: p2.id, role: "acquereur" })).rejects.toThrow(/Contact introuvable/);
    expect(await getDb().select().from(partiesProjetTable).where(eq(partiesProjetTable.projetAcquereurId, p2.id))).toEqual([]);
  });

  it("enregistrerReferenceExterne : cible contact gardée, cible interaction inchangée", async () => {
    const s = await unContact();
    const a = await unContact();
    await absorber(a, s);
    const ok = await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-ok`, cible: { type: "contact", id: s.id } }, WORKSPACE_TEST);
    expect(ok.cible).toEqual({ type: "contact", id: s.id });
    await expect(
      enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-ko`, cible: { type: "contact", id: a.id } }, WORKSPACE_TEST)
    ).rejects.toBeInstanceOf(ErreurContactFusionne);
    await expect(
      enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-ko2`, cible: { type: "contact", id: INCONNU } }, WORKSPACE_TEST)
    ).rejects.toThrow(/Entité canonique introuvable/);
    expect(await getDb().select().from(referencesExternesTable).where(eq(referencesExternesTable.contactId, a.id))).toEqual([]);
    // Une référence sur une interaction du survivant : autorisée, sans garde contact.
    const interaction = await creerInteraction({ contactId: s.id, type: "email", sens: "sortant", survenuLe: "2026-03-01T10:00:00.000Z" });
    const ref = await enregistrerReferenceExterne({ fournisseur: "gmail", typeEntiteExterne: "message", idExterne: `${M}-msg`, cible: { type: "interaction", id: interaction.id } }, WORKSPACE_TEST);
    expect(ref.cible).toEqual({ type: "interaction", id: interaction.id });
  });

  it("verrouillerChamp : aucun nouveau verrou sur un absorbé, les verrous historiques restent", async () => {
    const s = await unContact({ email: unEmail() });
    const a = await unContact({ email: unEmail() });
    await verrouillerChamp({ type: "contact", id: a.id }, "email", WORKSPACE_TEST);
    await absorber(a, s);
    const ok = await verrouillerChamp({ type: "contact", id: s.id }, "nom", WORKSPACE_TEST);
    expect(ok.cible).toEqual({ type: "contact", id: s.id });
    await expect(verrouillerChamp({ type: "contact", id: a.id }, "telephone", WORKSPACE_TEST)).rejects.toBeInstanceOf(ErreurContactFusionne);
    // Même un verrou déjà existant n'est pas « relu » sur un absorbé : refus avant toute lecture.
    await expect(verrouillerChamp({ type: "contact", id: a.id }, "email", WORKSPACE_TEST)).rejects.toBeInstanceOf(ErreurContactFusionne);
    await expect(verrouillerChamp({ type: "contact", id: INCONNU }, "email", WORKSPACE_TEST)).rejects.toThrow(/Entité canonique introuvable/);
    const verrousA = await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, a.id));
    expect(verrousA.map((v) => v.champ)).toEqual(["email"]);
  });

  it("creerAcquereur : sans contactId inchangé ; actif OK ; absorbé et introuvable refusés AVANT insertion", async () => {
    const s = await unContact();
    const a = await unContact();
    await absorber(a, s);
    const sans = await creerAcquereur(dossierAcquereur(undefined), WORKSPACE_TEST);
    idsAcquereurs.push(sans.id);
    const avec = await creerAcquereur(dossierAcquereur(s.id), WORKSPACE_TEST);
    idsAcquereurs.push(avec.id);
    const avant = await getDb().select().from(acquereursTable).where(eq(acquereursTable.workspaceId, WORKSPACE_TEST));
    await expect(creerAcquereur(dossierAcquereur(a.id), WORKSPACE_TEST)).rejects.toBeInstanceOf(ErreurContactFusionne);
    await expect(creerAcquereur(dossierAcquereur(INCONNU), WORKSPACE_TEST)).rejects.toThrow(/Contact introuvable/);
    const apres = await getDb().select().from(acquereursTable).where(eq(acquereursTable.workspaceId, WORKSPACE_TEST));
    expect(apres.length).toBe(avant.length);
  });

  it("creerProspectVendeur : même matrice", async () => {
    const s = await unContact();
    const a = await unContact();
    await absorber(a, s);
    const sans = await creerProspectVendeur(dossierVendeur(undefined), WORKSPACE_TEST);
    idsProspects.push(sans.id);
    const avec = await creerProspectVendeur(dossierVendeur(s.id), WORKSPACE_TEST);
    idsProspects.push(avec.id);
    const avant = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.workspaceId, WORKSPACE_TEST));
    await expect(creerProspectVendeur(dossierVendeur(a.id), WORKSPACE_TEST)).rejects.toBeInstanceOf(ErreurContactFusionne);
    await expect(creerProspectVendeur(dossierVendeur(INCONNU), WORKSPACE_TEST)).rejects.toThrow(/Contact introuvable/);
    const apres = await getDb().select().from(prospectsVendeursTable).where(eq(prospectsVendeursTable.workspaceId, WORKSPACE_TEST));
    expect(apres.length).toBe(avant.length);
  });

  it("autre workspace : refus indistinguable d'un id inconnu, pour chaque writer avec workspace", async () => {
    const autre = `${M}-ws2`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre garde 2" });
    idsWorkspaces.push(autre);
    const ailleurs = await unContact({}, autre);
    await expect(creerAcquereur(dossierAcquereur(ailleurs.id), WORKSPACE_TEST)).rejects.toThrow(/Contact introuvable/);
    await expect(creerProspectVendeur(dossierVendeur(ailleurs.id), WORKSPACE_TEST)).rejects.toThrow(/Contact introuvable/);
  });
});

// CONCURRENCE — T1 : writer sur B dans une transaction tenue ouverte ; T2 : fusion B → A lancée
// pendant que T1 tient le verrou. Puis l'ordre inverse. Invariant : après les deux, aucune ligne
// vivante nouvelle ne pointe B.
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function course(
  writer: (contactId: string, tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) => Promise<void>,
  compterSur: (contactId: string) => Promise<number>,
  // Les verrous humains ne sont pas repointés par le moteur (ADR-059) : pour eux, l'invariant
  // se limite à « rien de posé après l'absorption ».
  repointeVersSurvivant = true
) {
  // Ordre 1 : le writer verrouille B d'abord, la fusion attend, puis repointe.
  {
    const s = await unContact();
    const a = await unContact();
    const t1 = getDb().transaction(async (tx) => {
      await writer(a.id, tx);
      await attendre(400);
    });
    await attendre(100);
    const t2 = absorber(a, s);
    await Promise.all([t1, t2]);
    expect(await compterSur(a.id), "ordre writer→fusion : rien ne reste sur l'absorbé").toBe(0);
    if (repointeVersSurvivant) {
      expect(await compterSur(s.id), "ordre writer→fusion : repointé vers le survivant").toBeGreaterThan(0);
    }
  }
  // Ordre 2 : la fusion tient le verrou, le writer attend, puis voit B absorbé et refuse.
  {
    const s = await unContact();
    const a = await unContact();
    const t2 = absorber(a, s);
    const t1 = getDb()
      .transaction(async (tx) => {
        await attendre(50);
        await writer(a.id, tx);
      })
      .then(() => "ecrit" as const)
      .catch((e: unknown) => (e instanceof ErreurContactFusionne ? ("refuse" as const) : Promise.reject(e)));
    const [, issue] = await Promise.all([t2, t1]);
    expect(["ecrit", "refuse"]).toContain(issue);
    expect(await compterSur(a.id), "ordre fusion→writer : rien sur l'absorbé").toBe(0);
  }
}

describe("concurrence writer / fusion — aucune donnée vivante ne reste sur un absorbé", () => {
  const compter = async (table: typeof interactionsTable | typeof partiesProjetTable | typeof referencesExternesTable | typeof champsVerrouillesTable | typeof acquereursTable | typeof prospectsVendeursTable, contactId: string) =>
    (await getDb().select().from(table).where(eq(table.contactId, contactId))).length;

  it("interaction", async () => {
    await course(
      async (contactId, tx) => {
        await creerInteraction({ contactId, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" }, tx);
      },
      (id) => compter(interactionsTable, id)
    );
  });

  it("partie de projet", async () => {
    await course(
      async (contactId, tx) => {
        const p = await unProjet();
        await ajouterPartieProjet({ contactId, projetAcquereurId: p.id, role: "acquereur" }, tx);
      },
      (id) => compter(partiesProjetTable, id)
    );
  });

  it("référence externe contact", async () => {
    await course(
      async (contactId, tx) => {
        await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-race-${++compteur}`, cible: { type: "contact", id: contactId } }, WORKSPACE_TEST, tx);
      },
      (id) => compter(referencesExternesTable, id)
    );
  });

  it("verrou humain", async () => {
    await course(
      async (contactId, tx) => {
        await verrouillerChamp({ type: "contact", id: contactId }, "nom", WORKSPACE_TEST, tx);
      },
      async (id) => {
        // Les verrous de l'absorbé ne sont pas repointés par le moteur (ADR-059) : l'invariant est
        // qu'aucun verrou n'a été posé APRÈS l'absorption. Ordre 1 : le verrou date d'avant la
        // fusion et reste (historique) ; on ne compte donc que ceux posés après `fusionne_le`.
        const [c] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, id));
        const verrous = await getDb().select().from(champsVerrouillesTable).where(eq(champsVerrouillesTable.contactId, id));
        if (c.fusionneLe === null) return verrous.length;
        return verrous.filter((v) => v.verrouilleLe > c.fusionneLe!).length;
      },
      false
    );
  });

  it("dossier acquéreur", async () => {
    await course(
      async (contactId, tx) => {
        const d = await creerAcquereur(dossierAcquereur(contactId), WORKSPACE_TEST, tx);
        idsAcquereurs.push(d.id);
      },
      (id) => compter(acquereursTable, id)
    );
  });

  it("dossier vendeur", async () => {
    await course(
      async (contactId, tx) => {
        const d = await creerProspectVendeur(dossierVendeur(contactId), WORKSPACE_TEST, tx);
        idsProspects.push(d.id);
      },
      (id) => compter(prospectsVendeursTable, id)
    );
  });
});
