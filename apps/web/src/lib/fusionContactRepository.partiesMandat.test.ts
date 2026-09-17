import { afterAll, describe, expect, it, vi } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { Contact } from "@/types/contact";

// ADR-060 §16 — le moteur de fusion Contact (ADR-059) repointe `parties_mandat` : simple repoint,
// dédoublonnage sur (mandat, contact) — même rôle, rôles différents avec priorité déterministe
// mandant > representant —, plusieurs mandats et plusieurs parties, ids exacts dans le journal,
// rollback intégral, workspace inchangé, chaîne de fusions, et la CONCURRENCE avec le writer :
// quel que soit l'ordre, aucune partie ne reste sur un absorbé.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { echecMarqueur } = vi.hoisted(() => ({ echecMarqueur: { actif: false } }));
vi.mock("@/lib/contactRepository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/contactRepository")>();
  return {
    ...original,
    marquerContactFusionne: (...args: Parameters<typeof original.marquerContactFusionne>) => {
      if (echecMarqueur.actif) throw new Error("échec simulé du marqueur");
      return original.marquerContactFusionne(...args);
    },
  };
});

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  mandats: mandatsTable,
  partiesMandat: partiesMandatTable,
} = await import("@/db/schema");
const { creerContact, getContactDuWorkspace } = await import("@/lib/contactRepository");
const { creerBien } = await import("@/lib/bienRepository");
const { creerMandat } = await import("@/lib/mandatRepository");
const { fusionnerContacts } = await import("@/lib/fusionContactRepository");
const { ajouterPartieMandat, listerPartiesMandat, retirerPartieMandat } = await import("@/lib/partieMandatRepository");

const M = `Zfusionmandat${Date.now()}`;
const idsContacts: string[] = [];
const idsBiens: string[] = [];
let compteur = 0;

afterAll(async () => {
  if (idsBiens.length > 0) {
    const mandats = (await getDb().select({ id: mandatsTable.id }).from(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens))).map((m) => m.id);
    if (mandats.length > 0) await getDb().delete(partiesMandatTable).where(inArray(partiesMandatTable.mandatId, mandats));
    await getDb().delete(mandatsTable).where(inArray(mandatsTable.bienId, idsBiens));
    await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  }
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
});

async function unContact(nom = `${M} Contact`) {
  const contact = await creerContact({ nom }, WORKSPACE_TEST);
  idsContacts.push(contact.id);
  return contact;
}

async function unMandat() {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `[test réel] FUSION-PARTIES-${compteur}-${Date.now()}`,
      titre: "Bien de test fusion parties",
      type: "maison",
      adresse: "2 rue de la Fusion",
      ville: "Testville",
      codePostal: "00000",
      surface: 90,
      pieces: 4,
      prix: 400000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    WORKSPACE_TEST
  );
  idsBiens.push(bien.id);
  return creerMandat({ bienId: bien.id, dateDebut: "2026-01-01", type: "simple" });
}

async function partie(mandatId: string, contactId: string, role: "mandant" | "representant") {
  const r = await ajouterPartieMandat(mandatId, { contactId, role }, WORKSPACE_TEST);
  if (r.statut !== "ajoutee") throw new Error(`ajout attendu, reçu ${r.statut}`);
  return r.partie;
}

const attendue = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });

async function fusionner(survivant: Contact, absorbe: Contact) {
  return fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: attendue(survivant),
    identiteAttendueAbsorbe: attendue(absorbe),
    identiteFinale: { nom: survivant.nom },
    choixParChamp: { nom: "survivant", prenom: "identique", email: "identique", telephone: "identique" },
    acteur: { sub: "sub-test", email: "conseiller@example.test" },
  });
}

async function fusionne(survivant: Contact, absorbe: Contact) {
  const r = await fusionner(survivant, absorbe);
  if (r.statut !== "fusionne") throw new Error(`fusion attendue, reçu ${r.statut}`);
  return r;
}

async function partiesDuContact(contactId: string) {
  return getDb().select().from(partiesMandatTable).where(eq(partiesMandatTable.contactId, contactId)).orderBy(asc(partiesMandatTable.creeLe));
}

async function partiesDuMandat(mandatId: string) {
  return getDb().select().from(partiesMandatTable).where(eq(partiesMandatTable.mandatId, mandatId)).orderBy(asc(partiesMandatTable.creeLe));
}

describe("fusionnerContacts — parties de mandat", () => {
  it("A. B mandant, A absent : la partie est repointée vers A, rôle et id conservés", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    const pb = await partie(m.id, b.id, "mandant");
    const r = await fusionne(a, b);
    expect(await partiesDuContact(b.id)).toEqual([]);
    expect((await partiesDuMandat(m.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[pb.id, a.id, "mandant"]]);
    expect(r.idsDeplaces.partiesMandat).toEqual([pb.id]);
    expect(r.idsDeplaces.partiesMandatSupprimees).toEqual([]);
    expect(r.idsDeplaces.partiesMandatRoleCorrige).toEqual([]);
    // Le read model rend l'identité du survivant.
    expect((await listerPartiesMandat(m.id, WORKSPACE_TEST)).map((p) => p.contact.id)).toEqual([a.id]);
  });

  it("B. A et B mandants du même mandat : une seule ligne, celle de A, la partie de B supprimée", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    const pa = await partie(m.id, a.id, "mandant");
    const pb = await partie(m.id, b.id, "mandant");
    const r = await fusionne(a, b);
    expect((await partiesDuMandat(m.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[pa.id, a.id, "mandant"]]);
    expect(await getDb().select().from(partiesMandatTable).where(eq(partiesMandatTable.id, pb.id))).toEqual([]);
    expect(r.idsDeplaces.partiesMandat).toEqual([]);
    expect(r.idsDeplaces.partiesMandatSupprimees).toEqual([pb.id]);
    expect(r.idsDeplaces.partiesMandatRoleCorrige).toEqual([]);
  });

  it("C. A representant + B mandant : A devient mandant (mandant > representant), correction journalisée", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    const pa = await partie(m.id, a.id, "representant");
    const pb = await partie(m.id, b.id, "mandant");
    const r = await fusionne(a, b);
    expect((await partiesDuMandat(m.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[pa.id, a.id, "mandant"]]);
    expect(r.idsDeplaces.partiesMandatSupprimees).toEqual([pb.id]);
    expect(r.idsDeplaces.partiesMandatRoleCorrige).toEqual([{ partieId: pa.id, roleAvant: "representant", roleFinal: "mandant" }]);
    expect(r.idsDeplaces.partiesMandat).toEqual([]);
  });

  it("D. A mandant + B representant : A reste mandant, aucune correction, partie de B supprimée", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    const pa = await partie(m.id, a.id, "mandant");
    const pb = await partie(m.id, b.id, "representant");
    const r = await fusionne(a, b);
    expect((await partiesDuMandat(m.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[pa.id, a.id, "mandant"]]);
    expect(r.idsDeplaces.partiesMandatSupprimees).toEqual([pb.id]);
    expect(r.idsDeplaces.partiesMandatRoleCorrige).toEqual([]);
  });

  it("E/F/G. plusieurs mandats, plusieurs parties : repoint, dédoublonnage et correction mandat par mandat, ids exacts dans le journal", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const c = await unContact(`${M} C`);
    const m1 = await unMandat(); // B seul : repoint
    const m2 = await unMandat(); // A mandant + B mandant : suppression
    const m3 = await unMandat(); // A representant + B mandant + C representant : correction
    const m4 = await unMandat(); // A seul : intact
    const p1b = await partie(m1.id, b.id, "representant");
    const p2a = await partie(m2.id, a.id, "mandant");
    const p2b = await partie(m2.id, b.id, "mandant");
    const p3a = await partie(m3.id, a.id, "representant");
    const p3b = await partie(m3.id, b.id, "mandant");
    const p3c = await partie(m3.id, c.id, "representant");
    const p4a = await partie(m4.id, a.id, "mandant");

    const r = await fusionne(a, b);

    expect(await partiesDuContact(b.id)).toEqual([]);
    expect((await partiesDuMandat(m1.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[p1b.id, a.id, "representant"]]);
    expect((await partiesDuMandat(m2.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[p2a.id, a.id, "mandant"]]);
    expect((await partiesDuMandat(m3.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([
      [p3a.id, a.id, "mandant"],
      [p3c.id, c.id, "representant"],
    ]);
    expect((await partiesDuMandat(m4.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[p4a.id, a.id, "mandant"]]);

    expect(r.idsDeplaces.partiesMandat).toEqual([p1b.id]);
    expect([...r.idsDeplaces.partiesMandatSupprimees!].sort()).toEqual([p2b.id, p3b.id].sort());
    expect(r.idsDeplaces.partiesMandatRoleCorrige).toEqual([{ partieId: p3a.id, roleAvant: "representant", roleFinal: "mandant" }]);
    // Le journal persiste exactement ce que le moteur a rendu, et garde les clés parties_projet.
    const [journal] = await getDb().select().from(contactFusionsTable).where(eq(contactFusionsTable.contactAbsorbeId, b.id));
    expect(journal.idsDeplaces).toEqual(r.idsDeplaces);
    expect(journal.idsDeplaces).toMatchObject({ partiesProjet: [], partiesProjetSupprimees: [], partiesProjetRoleCorrige: [] });
  });

  it("H. rollback : un échec après les repoints laisse les parties de mandat intactes, aucun journal", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m1 = await unMandat();
    const m2 = await unMandat();
    const p1b = await partie(m1.id, b.id, "mandant");
    const p2a = await partie(m2.id, a.id, "representant");
    const p2b = await partie(m2.id, b.id, "mandant");

    echecMarqueur.actif = true;
    try {
      await expect(fusionner(a, b)).rejects.toThrow(/échec simulé du marqueur/);
    } finally {
      echecMarqueur.actif = false;
    }

    expect((await partiesDuMandat(m1.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[p1b.id, b.id, "mandant"]]);
    expect((await partiesDuMandat(m2.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([
      [p2a.id, a.id, "representant"],
      [p2b.id, b.id, "mandant"],
    ]);
    expect(await getDb().select().from(contactFusionsTable).where(eq(contactFusionsTable.contactAbsorbeId, b.id))).toEqual([]);
    expect((await getContactDuWorkspace(b.id, WORKSPACE_TEST))?.fusionneDansContactId).toBeUndefined();
  });

  it("I. workspace inchangé : la partie repointée reste lisible dans le workspace du bien, et nulle part ailleurs", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    await partie(m.id, b.id, "mandant");
    await fusionne(a, b);
    expect((await listerPartiesMandat(m.id, WORKSPACE_TEST)).map((p) => p.contactId)).toEqual([a.id]);
    expect(await listerPartiesMandat(m.id, "un-autre-workspace")).toEqual([]);
  });

  it("J. chaîne : C absorbe B, puis A absorbe C — les parties finissent sur A, jamais sur un absorbé", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const c = await unContact(`${M} C`);
    const m1 = await unMandat();
    const m2 = await unMandat();
    const p1b = await partie(m1.id, b.id, "mandant");
    const p2a = await partie(m2.id, a.id, "representant");
    const p2c = await partie(m2.id, c.id, "mandant");
    await fusionne(c, b);
    expect((await partiesDuMandat(m1.id)).map((p) => [p.id, p.contactId])).toEqual([[p1b.id, c.id]]);
    const cActif = (await getContactDuWorkspace(c.id, WORKSPACE_TEST)) as Contact;
    const r = await fusionne(a, cActif);
    expect((await partiesDuMandat(m1.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[p1b.id, a.id, "mandant"]]);
    expect((await partiesDuMandat(m2.id)).map((p) => [p.id, p.contactId, p.role])).toEqual([[p2a.id, a.id, "mandant"]]);
    expect(r.idsDeplaces.partiesMandatSupprimees).toEqual([p2c.id]);
    expect(await partiesDuContact(b.id)).toEqual([]);
    expect(await partiesDuContact(c.id)).toEqual([]);
  });
});

// CONCURRENCE — T1 : ajout de B comme partie dans une transaction tenue ouverte ; T2 : fusion B → A
// lancée pendant que T1 tient le verrou du contact. Puis l'ordre inverse. Invariant : après les
// deux, aucune partie ne pointe B.
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("concurrence fusion × parties de mandat — aucune partie ne reste sur un absorbé", () => {
  it("ajout partie gagne : la fusion attend le verrou du contact, puis repointe vers le survivant", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    let issueAjout: string | undefined;
    const t1 = getDb().transaction(async (tx) => {
      issueAjout = (await ajouterPartieMandat(m.id, { contactId: b.id, role: "mandant" }, WORKSPACE_TEST, tx)).statut;
      await attendre(400);
    });
    await attendre(100);
    const t2 = fusionner(a, b);
    const [, fusion] = await Promise.all([t1, t2]);
    expect(issueAjout).toBe("ajoutee");
    expect(fusion.statut).toBe("fusionne");
    expect(await partiesDuContact(b.id)).toEqual([]);
    expect((await partiesDuMandat(m.id)).map((p) => [p.contactId, p.role])).toEqual([[a.id, "mandant"]]);
    if (fusion.statut === "fusionne") expect(fusion.idsDeplaces.partiesMandat).toHaveLength(1);
  });

  it("fusion gagne : l'ajout attend, voit B absorbé et refuse (contact_fusionne), rien sur B ni sur A", async () => {
    const a = await unContact(`${M} A`);
    const b = await unContact(`${M} B`);
    const m = await unMandat();
    const t2 = fusionner(a, b);
    const t1 = getDb().transaction(async (tx) => {
      await attendre(50);
      return ajouterPartieMandat(m.id, { contactId: b.id, role: "mandant" }, WORKSPACE_TEST, tx);
    });
    const [fusion, ajout] = await Promise.all([t2, t1]);
    expect(fusion.statut).toBe("fusionne");
    expect(ajout).toEqual({ statut: "contact_fusionne" });
    expect(await partiesDuMandat(m.id)).toEqual([]);
  });

  it("retrait × fusion : le retrait de la partie de B et la fusion B → A, dans les deux ordres, laissent zéro partie sur B", async () => {
    // Retrait d'abord : la fusion ne trouve plus rien à repointer.
    {
      const a = await unContact(`${M} A`);
      const b = await unContact(`${M} B`);
      const m = await unMandat();
      const pb = await partie(m.id, b.id, "mandant");
      const t1 = getDb().transaction(async (tx) => {
        await retirerPartieMandat(pb.id, WORKSPACE_TEST, tx);
        await attendre(400);
      });
      await attendre(100);
      const [, fusion] = await Promise.all([t1, fusionner(a, b)]);
      expect(fusion.statut).toBe("fusionne");
      if (fusion.statut === "fusionne") expect(fusion.idsDeplaces.partiesMandat).toEqual([]);
      expect(await partiesDuMandat(m.id)).toEqual([]);
    }
    // Fusion d'abord : la partie a été repointée vers A, le retrait (par id) l'enlève à A.
    {
      const a = await unContact(`${M} A`);
      const b = await unContact(`${M} B`);
      const m = await unMandat();
      const pb = await partie(m.id, b.id, "mandant");
      const t2 = fusionner(a, b);
      const t1 = getDb().transaction(async (tx) => {
        await attendre(50);
        return retirerPartieMandat(pb.id, WORKSPACE_TEST, tx);
      });
      const [fusion, retrait] = await Promise.all([t2, t1]);
      expect(fusion.statut).toBe("fusionne");
      expect(retrait.statut).toBe("retiree");
      expect(await partiesDuMandat(m.id)).toEqual([]);
      expect(await partiesDuContact(b.id)).toEqual([]);
    }
  });
});
