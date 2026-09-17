import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// ADR-060 §16 — MANDATE_PARTIES_V1, intégration Postgres : la relation mandat ↔ contact. Un writer
// scoped (mandat via son bien, contact actif du même workspace, une personne une fois par mandat),
// le retrait et la requalification d'une partie, la lecture jointe en une requête, et le mandat
// legacy sans partie qui reste lisible. La fusion et la concurrence ont leur propre fichier.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  mandats: mandatsTable,
  partiesMandat: partiesMandatTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerBien } = await import("./bienRepository");
const { creerContact } = await import("./contactRepository");
const { creerMandat } = await import("./mandatRepository");
const { fusionnerContacts } = await import("./fusionContactRepository");
const { ajouterPartieMandat, listerPartiesMandat, modifierRolePartieMandat, retirerPartieMandat } = await import(
  "./partieMandatRepository"
);

const M = `Zpartie${Date.now()}`;
const biensCrees: string[] = [];
const contactsCrees: string[] = [];
const workspacesCrees: string[] = [];
let compteur = 0;

async function unBien(workspaceId: string = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] PARTIES-MANDAT-${compteur}-${Date.now()}`,
      titre: "Bien de test parties de mandat",
      type: "appartement",
      adresse: "1 rue du Mandant",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 2,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  biensCrees.push(bien.id);
  return bien;
}

async function unMandat(workspaceId: string = WORKSPACE_TEST) {
  const bien = await unBien(workspaceId);
  return creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "exclusif" });
}

async function unContact(surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string } = {}, workspaceId = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspaceId);
  contactsCrees.push(contact.id);
  return contact;
}

async function unAutreWorkspace(suffixe: string) {
  const id = `ws-parties-${suffixe}-${Date.now()}`;
  await getDb().insert(workspacesTable).values({ id, nom: "[test réel] autre workspace parties" });
  workspacesCrees.push(id);
  return id;
}

async function partiesEnBase(mandatId: string) {
  return getDb().select().from(partiesMandatTable).where(eq(partiesMandatTable.mandatId, mandatId));
}

afterAll(async () => {
  if (biensCrees.length > 0) {
    const mandats = (await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees))).map((m) => m.id);
    if (mandats.length > 0) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, mandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, biensCrees));
    await getDb().delete(biensTable).where(inArray(biensTable.id, biensCrees));
  }
  if (contactsCrees.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, contactsCrees));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, contactsCrees));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, contactsCrees));
  }
  if (workspacesCrees.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, workspacesCrees));
});

describe("ajouterPartieMandat — la relation, dans le workspace de session", () => {
  it("A. un mandant : la partie est créée et relue avec l'identité du contact", async () => {
    const mandat = await unMandat();
    const a = await unContact({ nom: `${M} Durand`, prenom: "Alice", email: `${M}.a@example.test`, telephone: "0611111111" });
    const resultat = await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST);
    expect(resultat.statut).toBe("ajoutee");
    if (resultat.statut !== "ajoutee") return;
    expect(resultat.partie).toMatchObject({ mandatId: mandat.id, contactId: a.id, role: "mandant" });
    expect(resultat.partie.creeLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const parties = await listerPartiesMandat(mandat.id, WORKSPACE_TEST);
    expect(parties).toEqual([
      {
        ...resultat.partie,
        contact: { id: a.id, nom: `${M} Durand`, prenom: "Alice", email: `${M}.a@example.test`, telephone: "0611111111" },
      },
    ]);
  });

  it("B/C. deux mandants et un représentant : trois parties, ordre d'ajout, aucune limite", async () => {
    const mandat = await unMandat();
    const a = await unContact({ nom: `${M} A` });
    const b = await unContact({ nom: `${M} B` });
    const c = await unContact({ nom: `${M} C` });
    expect((await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
    expect((await ajouterPartieMandat(mandat.id, { contactId: b.id, role: "mandant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
    expect((await ajouterPartieMandat(mandat.id, { contactId: c.id, role: "representant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
    const parties = await listerPartiesMandat(mandat.id, WORKSPACE_TEST);
    expect(parties.map((p) => [p.contactId, p.role])).toEqual([
      [a.id, "mandant"],
      [b.id, "mandant"],
      [c.id, "representant"],
    ]);
    // NULL Postgres -> absent : un contact sans prénom n'a pas un prénom `null`.
    expect(parties[0].contact).toEqual({ id: a.id, nom: `${M} A` });
  });

  it("D/E. une personne, une fois par mandat : même rôle ou autre rôle, `deja_partie` rend l'existante, aucune seconde ligne", async () => {
    const mandat = await unMandat();
    const a = await unContact();
    const premiere = await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST);
    if (premiere.statut !== "ajoutee") throw new Error(premiere.statut);
    expect(await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "deja_partie", partie: premiere.partie });
    expect(await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "representant" }, WORKSPACE_TEST)).toEqual({ statut: "deja_partie", partie: premiere.partie });
    expect(await partiesEnBase(mandat.id)).toHaveLength(1);
    expect((await partiesEnBase(mandat.id))[0].role).toBe("mandant");
  });

  it("le même contact peut être partie de plusieurs mandats", async () => {
    const m1 = await unMandat();
    const m2 = await unMandat();
    const a = await unContact();
    expect((await ajouterPartieMandat(m1.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
    expect((await ajouterPartieMandat(m2.id, { contactId: a.id, role: "representant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
    expect((await listerPartiesMandat(m1.id, WORKSPACE_TEST)).map((p) => p.role)).toEqual(["mandant"]);
    expect((await listerPartiesMandat(m2.id, WORKSPACE_TEST)).map((p) => p.role)).toEqual(["representant"]);
  });

  it("F. mandat d'un autre workspace, inconnu ou id invalide : mandat_introuvable, rien d'écrit", async () => {
    const autre = await unAutreWorkspace("mandat");
    const mandatAilleurs = await unMandat(autre);
    const a = await unContact();
    expect(await ajouterPartieMandat(mandatAilleurs.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "mandat_introuvable" });
    expect(await ajouterPartieMandat("00000000-0000-4000-8000-000000000000", { contactId: a.id, role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "mandat_introuvable" });
    expect(await ajouterPartieMandat("pas-un-uuid", { contactId: a.id, role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "mandat_introuvable" });
    expect(await partiesEnBase(mandatAilleurs.id)).toEqual([]);
  });

  it("G. contact d'un autre workspace, inconnu ou id invalide : contact_introuvable, indistinguables, rien d'écrit", async () => {
    const autre = await unAutreWorkspace("contact");
    const mandat = await unMandat();
    const ailleurs = await unContact({}, autre);
    expect(await ajouterPartieMandat(mandat.id, { contactId: ailleurs.id, role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "contact_introuvable" });
    expect(await ajouterPartieMandat(mandat.id, { contactId: "00000000-0000-4000-8000-000000000000", role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "contact_introuvable" });
    expect(await ajouterPartieMandat(mandat.id, { contactId: "pas-un-uuid", role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "contact_introuvable" });
    // Le mandat de l'autre workspace ne voit pas davantage un contact d'ici.
    const mandatAilleurs = await unMandat(autre);
    const ici = await unContact();
    expect(await ajouterPartieMandat(mandatAilleurs.id, { contactId: ici.id, role: "mandant" }, autre)).toEqual({ statut: "contact_introuvable" });
    expect(await partiesEnBase(mandat.id)).toEqual([]);
    expect(await partiesEnBase(mandatAilleurs.id)).toEqual([]);
  });

  it("H. contact absorbé : contact_fusionne, jamais réécrit vers le survivant, rien d'écrit", async () => {
    const mandat = await unMandat();
    const s = await unContact({ nom: `${M} Survivant` });
    const b = await unContact({ nom: `${M} Absorbé` });
    const fusion = await fusionnerContacts({
      workspaceId: WORKSPACE_TEST,
      contactSurvivantId: s.id,
      contactAbsorbeId: b.id,
      identiteAttendueSurvivant: { nom: s.nom, modifieLe: s.modifieLe },
      identiteAttendueAbsorbe: { nom: b.nom, modifieLe: b.modifieLe },
      identiteFinale: { nom: s.nom },
      choixParChamp: { nom: "survivant", prenom: "identique", email: "identique", telephone: "identique" },
      acteur: {},
    });
    expect(fusion.statut).toBe("fusionne");
    expect(await ajouterPartieMandat(mandat.id, { contactId: b.id, role: "mandant" }, WORKSPACE_TEST)).toEqual({ statut: "contact_fusionne" });
    expect(await partiesEnBase(mandat.id)).toEqual([]);
    // Le survivant, nommé explicitement, reste une destination valide.
    expect((await ajouterPartieMandat(mandat.id, { contactId: s.id, role: "mandant" }, WORKSPACE_TEST)).statut).toBe("ajoutee");
  });
});

describe("listerPartiesMandat — lecture jointe, scoped", () => {
  it("I/K. un mandat legacy sans partie rend [], un mandat d'un autre workspace ou inconnu aussi", async () => {
    const mandat = await unMandat();
    expect(await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).toEqual([]);
    const autre = await unAutreWorkspace("lecture");
    const a = await unContact();
    await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST);
    expect(await listerPartiesMandat(mandat.id, autre)).toEqual([]);
    expect(await listerPartiesMandat("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toEqual([]);
    expect(await listerPartiesMandat("pas-un-uuid", WORKSPACE_TEST)).toEqual([]);
    expect(await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).toHaveLength(1);
  });

  it("J. une seule requête, que le mandat ait une partie ou cinq", async () => {
    const mandat = await unMandat();
    for (let i = 0; i < 5; i++) {
      const c = await unContact({ nom: `${M} N+1 ${i}` });
      await ajouterPartieMandat(mandat.id, { contactId: c.id, role: i === 0 ? "representant" : "mandant" }, WORKSPACE_TEST);
    }
    const db = getDb();
    const espion = vi.spyOn(db, "select");
    const parties = await listerPartiesMandat(mandat.id, WORKSPACE_TEST, db);
    const n = espion.mock.calls.length;
    espion.mockRestore();
    expect(parties).toHaveLength(5);
    expect(n).toBe(1);
  });
});

describe("retirerPartieMandat / modifierRolePartieMandat — corriger une sélection humaine", () => {
  it("L. retirer : la relation disparaît, le contact et le mandat restent ; autre workspace ou inconnu : introuvable", async () => {
    const mandat = await unMandat();
    const a = await unContact();
    const b = await unContact();
    const pa = await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "mandant" }, WORKSPACE_TEST);
    const pb = await ajouterPartieMandat(mandat.id, { contactId: b.id, role: "representant" }, WORKSPACE_TEST);
    if (pa.statut !== "ajoutee" || pb.statut !== "ajoutee") throw new Error("ajout attendu");

    const autre = await unAutreWorkspace("retrait");
    expect(await retirerPartieMandat(pb.partie.id, autre)).toEqual({ statut: "introuvable" });
    expect(await retirerPartieMandat("00000000-0000-4000-8000-000000000000", WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
    expect(await retirerPartieMandat("pas-un-uuid", WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
    expect(await partiesEnBase(mandat.id)).toHaveLength(2);

    expect(await retirerPartieMandat(pb.partie.id, WORKSPACE_TEST)).toEqual({ statut: "retiree", partie: pb.partie });
    expect(await retirerPartieMandat(pb.partie.id, WORKSPACE_TEST)).toEqual({ statut: "introuvable" });
    expect((await listerPartiesMandat(mandat.id, WORKSPACE_TEST)).map((p) => p.contactId)).toEqual([a.id]);
    expect(await getDb().select().from(contactsTable).where(eq(contactsTable.id, b.id))).toHaveLength(1);
    expect(await getDb().select().from(mandatsTable).where(eq(mandatsTable.id, mandat.id))).toHaveLength(1);
    // Retirée puis réajoutée : possible, nouvelle ligne.
    const encore = await ajouterPartieMandat(mandat.id, { contactId: b.id, role: "mandant" }, WORKSPACE_TEST);
    expect(encore.statut).toBe("ajoutee");
  });

  it("M. changer de rôle : mise à jour de la même ligne, `cree_le` intact ; autre workspace : introuvable", async () => {
    const mandat = await unMandat();
    const a = await unContact();
    const pa = await ajouterPartieMandat(mandat.id, { contactId: a.id, role: "representant" }, WORKSPACE_TEST);
    if (pa.statut !== "ajoutee") throw new Error(pa.statut);

    const autre = await unAutreWorkspace("role");
    expect(await modifierRolePartieMandat(pa.partie.id, "mandant", autre)).toEqual({ statut: "introuvable" });
    expect((await partiesEnBase(mandat.id))[0].role).toBe("representant");

    expect(await modifierRolePartieMandat(pa.partie.id, "mandant", WORKSPACE_TEST)).toEqual({
      statut: "modifiee",
      partie: { ...pa.partie, role: "mandant" },
    });
    // Même rôle : no-op, même résultat.
    expect(await modifierRolePartieMandat(pa.partie.id, "mandant", WORKSPACE_TEST)).toEqual({
      statut: "modifiee",
      partie: { ...pa.partie, role: "mandant" },
    });
    expect(await partiesEnBase(mandat.id)).toHaveLength(1);
    expect((await listerPartiesMandat(mandat.id, WORKSPACE_TEST))[0]).toMatchObject({ id: pa.partie.id, role: "mandant", creeLe: pa.partie.creeLe });
  });
});
