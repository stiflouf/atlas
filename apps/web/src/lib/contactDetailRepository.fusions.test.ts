import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-059 — « Contacts fusionnés » sur la fiche du survivant : les fiches DIRECTEMENT absorbées,
// lues dans le journal `contact_fusions` (identité d'alors, date, conseiller), jamais reconstituées
// depuis `contacts.fusionne_dans_contact_id`. Workspace vérifié dans la requête, ordre déterministe,
// aucune écriture.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const { chargerContactDetail, listerFusionsAbsorbees } = await import("@/lib/contactDetailRepository");

const M = `Zfusabs${Date.now()}`;
const idsContacts: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(identite: { nom: string; prenom?: string; email?: string; telephone?: string }, workspace = WORKSPACE_TEST) {
  const contact = await creerContact(identite, workspace);
  idsContacts.push(contact.id);
  return contact;
}

const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });

// Fusion RÉELLE par le moteur : le survivant garde son identité, l'absorbé est marqué, le journal
// est écrit — exactement l'état que la fiche doit lire.
async function fusionner(survivant: Contact, absorbe: Contact, acteur: { sub?: string; email?: string } = { sub: "sub-test", email: "conseiller@example.test" }) {
  const [s] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, survivant.id));
  const [a] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, absorbe.id));
  const survivantActuel: Contact = { ...survivant, nom: s.nom, prenom: s.prenom ?? undefined, email: s.email ?? undefined, telephone: s.telephone ?? undefined, modifieLe: s.modifieLe.toISOString() };
  const absorbeActuel: Contact = { ...absorbe, nom: a.nom, prenom: a.prenom ?? undefined, email: a.email ?? undefined, telephone: a.telephone ?? undefined, modifieLe: a.modifieLe.toISOString() };
  // Même règle que l'UI : valeur du survivant, ou l'unique valeur présente, ou l'identique.
  const champ = (k: "prenom" | "email" | "telephone") => {
    const vs = survivantActuel[k];
    const va = absorbeActuel[k];
    if (vs === va) return { choix: "identique" as const, valeur: vs };
    if (vs === undefined || va === undefined) return { choix: "absence_comblee" as const, valeur: vs ?? va };
    return { choix: "survivant" as const, valeur: vs };
  };
  const prenom = champ("prenom");
  const email = champ("email");
  const telephone = champ("telephone");
  const resultat = await fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: identite(survivantActuel),
    identiteAttendueAbsorbe: identite(absorbeActuel),
    identiteFinale: { nom: survivantActuel.nom, prenom: prenom.valeur, email: email.valeur, telephone: telephone.valeur },
    choixParChamp: { nom: "survivant", prenom: prenom.choix, email: email.choix, telephone: telephone.choix },
    acteur,
  });
  if (resultat.statut !== "fusionne") throw new Error(`fusion refusée : ${resultat.statut}`);
  return resultat;
}

async function detailActif(id: string, workspace = WORKSPACE_TEST) {
  const resultat = await chargerContactDetail(id, workspace);
  if (!resultat || resultat.type !== "actif") throw new Error(`attendu un contact actif : ${resultat?.type}`);
  return resultat.detail;
}

describe("listerFusionsAbsorbees / chargerContactDetail.fusionsAbsorbees", () => {
  it("A. aucun historique : tableau vide, et un id non UUID rend vide sans requête", async () => {
    const a = await unContact({ nom: `${M} Seul`, prenom: "Alice" });
    expect((await detailActif(a.id)).fusionsAbsorbees).toEqual([]);
    expect(await listerFusionsAbsorbees("pas-un-uuid", WORKSPACE_TEST)).toEqual([]);
  });

  it("B. B → A par le moteur : une entrée, identité de B d'alors, date, email du conseiller", async () => {
    const a = await unContact({ nom: `${M} Martin`, prenom: "Alice", email: `${M}.alice@example.test` });
    const b = await unContact({ nom: `${M} Durand`, prenom: "Bob", email: `${M}.bob@example.test`, telephone: "0611111111" });
    const { fusionId } = await fusionner(a, b);

    const fusions = (await detailActif(a.id)).fusionsAbsorbees;
    expect(fusions).toHaveLength(1);
    expect(fusions[0]).toEqual({
      fusionId,
      contactAbsorbeId: b.id,
      identiteAbsorbee: { nom: `${M} Durand`, prenom: "Bob", email: `${M}.bob@example.test`, telephone: "0611111111" },
      fusionneLe: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      fusionneParEmail: "conseiller@example.test",
    });
    expect(fusions[0]).not.toHaveProperty("fusionneParSub");
    expect(fusions[0]).not.toHaveProperty("idsDeplaces");
    expect(fusions[0]).not.toHaveProperty("choixParChamp");
  });

  it("C/D. B, C, D → A : trois entrées, la plus récente d'abord (fusionne_le DESC, id DESC)", async () => {
    const a = await unContact({ nom: `${M} Multi`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} Premier` });
    const c = await unContact({ nom: `${M} Deuxieme` });
    const d = await unContact({ nom: `${M} Troisieme` });
    const fb = await fusionner(a, b);
    const fc = await fusionner(a, c);
    const fd = await fusionner(a, d);
    // Dates forcées distinctes : l'ordre doit venir de `fusionne_le`, pas de l'insertion.
    await getDb().update(contactFusionsTable).set({ fusionneLe: new Date("2026-09-01T10:00:00Z") }).where(eq(contactFusionsTable.id, fb.fusionId));
    await getDb().update(contactFusionsTable).set({ fusionneLe: new Date("2026-09-03T10:00:00Z") }).where(eq(contactFusionsTable.id, fc.fusionId));
    await getDb().update(contactFusionsTable).set({ fusionneLe: new Date("2026-09-02T10:00:00Z") }).where(eq(contactFusionsTable.id, fd.fusionId));

    const fusions = (await detailActif(a.id)).fusionsAbsorbees;
    expect(fusions.map((f) => f.contactAbsorbeId)).toEqual([c.id, d.id, b.id]);
    expect(fusions.map((f) => f.identiteAbsorbee.nom)).toEqual([`${M} Deuxieme`, `${M} Troisieme`, `${M} Premier`]);
  });

  it("E. l'identité vient du JOURNAL (identite_avant_absorbe), pas de la ligne contacts de l'absorbé", async () => {
    const a = await unContact({ nom: `${M} Journal`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} AvantFusion`, prenom: "Bob" });
    await fusionner(a, b);
    // Divergence simulée hors produit (le writer refuse un absorbé) : la ligne change, pas le journal.
    await getDb().update(contactsTable).set({ nom: `${M} LigneReecrite` }).where(eq(contactsTable.id, b.id));
    const [fusion] = (await detailActif(a.id)).fusionsAbsorbees;
    expect(fusion.identiteAbsorbee).toEqual({ nom: `${M} AvantFusion`, prenom: "Bob" });
  });

  it("F/G. acteur : email rendu s'il existe, `undefined` sinon — jamais le sub", async () => {
    const a = await unContact({ nom: `${M} Acteur`, prenom: "Alice" });
    const avecEmail = await unContact({ nom: `${M} AvecEmail` });
    const sansEmail = await unContact({ nom: `${M} SansEmail` });
    await fusionner(a, avecEmail, { sub: "sub-x", email: "conseiller@example.test" });
    await fusionner(a, sansEmail, {});
    const fusions = (await detailActif(a.id)).fusionsAbsorbees;
    expect(fusions.find((f) => f.contactAbsorbeId === avecEmail.id)?.fusionneParEmail).toBe("conseiller@example.test");
    expect(fusions.find((f) => f.contactAbsorbeId === sansEmail.id)?.fusionneParEmail).toBeUndefined();
    expect(JSON.stringify(fusions)).not.toContain("sub-x");
  });

  it("H. workspace : le journal d'un survivant d'un autre workspace est vide, même appelé directement", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre fusions" });
    idsWorkspaces.push(autre);
    const a = await unContact({ nom: `${M} Ailleurs`, prenom: "Alice" }, autre);
    const b = await unContact({ nom: `${M} AilleursAbsorbe` }, autre);
    await fusionnerContacts({
      workspaceId: autre,
      contactSurvivantId: a.id,
      contactAbsorbeId: b.id,
      identiteAttendueSurvivant: identite(a),
      identiteAttendueAbsorbe: identite(b),
      identiteFinale: { nom: a.nom, prenom: "Alice" },
      choixParChamp: { nom: "survivant", prenom: "absence_comblee", email: "identique", telephone: "identique" },
      acteur: {},
    }).then((r) => expect(r.statut).toBe("fusionne"));

    expect(await listerFusionsAbsorbees(a.id, autre)).toHaveLength(1);
    expect(await listerFusionsAbsorbees(a.id, WORKSPACE_TEST)).toEqual([]);
    expect(await chargerContactDetail(a.id, WORKSPACE_TEST)).toBeUndefined();
  });

  it("L. chaîne A → B → C : C liste B seulement ; B (absorbé) ne charge aucun historique", async () => {
    const c = await unContact({ nom: `${M} Final`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} Milieu` });
    const a = await unContact({ nom: `${M} Origine` });
    await fusionner(b, a);
    await fusionner(c, b);

    const fusions = (await detailActif(c.id)).fusionsAbsorbees;
    expect(fusions.map((f) => f.contactAbsorbeId)).toEqual([b.id]);

    const db = getDb();
    const espion = vi.spyOn(db, "select");
    const resultatB = await chargerContactDetail(b.id, WORKSPACE_TEST, db);
    const n = espion.mock.calls.length;
    espion.mockRestore();
    expect(resultatB?.type).toBe("fusionne");
    expect(resultatB).not.toHaveProperty("fusionsAbsorbees");
    // Contact + résolution de chaîne (2 maillons) : aucune lecture du journal.
    expect(n).toBe(3);
  });

  it("journal manquant : un absorbé marqué sans ligne contact_fusions n'est pas inventé", async () => {
    const a = await unContact({ nom: `${M} SansJournal`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} MarqueSeul` });
    await getDb().update(contactsTable).set({ fusionneDansContactId: a.id, fusionneLe: new Date() }).where(eq(contactsTable.id, b.id));
    expect((await detailActif(a.id)).fusionsAbsorbees).toEqual([]);
  });

  it("aucune écriture en consultant : contacts et journal identiques avant/après", async () => {
    const a = await unContact({ nom: `${M} Lecture`, prenom: "Alice" });
    const b = await unContact({ nom: `${M} LectureAbsorbe` });
    await fusionner(a, b);
    const avant = await getDb().select().from(contactFusionsTable).where(eq(contactFusionsTable.contactSurvivantId, a.id));
    const contactsAvant = await getDb().select().from(contactsTable).where(inArray(contactsTable.id, [a.id, b.id]));
    await detailActif(a.id);
    await listerFusionsAbsorbees(a.id, WORKSPACE_TEST);
    expect(await getDb().select().from(contactFusionsTable).where(eq(contactFusionsTable.contactSurvivantId, a.id))).toEqual(avant);
    expect(await getDb().select().from(contactsTable).where(inArray(contactsTable.id, [a.id, b.id]))).toEqual(contactsAvant);
  });
});
