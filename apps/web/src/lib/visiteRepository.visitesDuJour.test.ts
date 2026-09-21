import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// VISIT_NATIVE_ENTRY_V1 — reader Today `visitesDuJour` : set-based (une requête), workspace-safe
// (via biens.workspace_id), tous statuts du jour, identité acquéreur effective (Contact si rattaché).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  biens: biensTable,
  acquereurs: acquereursTable,
  contacts: contactsTable,
  visites: visitesTable,
  workspaces: workspacesTable,
  evenementsMetier,
  executionsAutomatisation,
} = await import("@/db/schema");
const { creerBien } = await import("@/lib/bienRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerVisite, materialiserVisite, annulerVisite, visitesDuJour } = await import("@/lib/visiteRepository");

const M = `[test réel] VISITES-DU-JOUR ${Date.now()}`;
const JOUR = "2031-03-03";
const idsBiens: string[] = [];
const idsAcquereurs: string[] = [];
const idsContacts: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsBiens.length) {
    // evenements_metier référence visites en NO ACTION (annulation) : purgé avant les visites.
    const visites = await getDb().select({ id: visitesTable.id }).from(visitesTable).where(inArray(visitesTable.bienId, idsBiens));
    const idsVisites = visites.map((v) => v.id);
    if (idsVisites.length) {
      const evts = await getDb().select({ id: evenementsMetier.id }).from(evenementsMetier).where(inArray(evenementsMetier.visiteId, idsVisites));
      const idsEvts = evts.map((e) => e.id);
      if (idsEvts.length) {
        await getDb().delete(executionsAutomatisation).where(inArray(executionsAutomatisation.evenementId, idsEvts));
        await getDb().delete(evenementsMetier).where(inArray(evenementsMetier.id, idsEvts));
      }
      await getDb().delete(visitesTable).where(inArray(visitesTable.id, idsVisites));
    }
  }
  for (const id of idsBiens) await getDb().delete(biensTable).where(eq(biensTable.id, id));
  for (const id of idsAcquereurs) await getDb().delete(acquereursTable).where(eq(acquereursTable.id, id));
  for (const id of idsContacts) await getDb().delete(contactsTable).where(eq(contactsTable.id, id));
  if (idsWorkspaces.length) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unBien(suffixe: string, workspaceId = WORKSPACE_TEST) {
  const bien = await creerBien(
    {
      reference: `${M}-${suffixe}`,
      titre: `${M} ${suffixe}`,
      type: "appartement",
      adresse: "1 rue du Test",
      ville: "Testville",
      codePostal: "00000",
      surface: 50,
      pieces: 3,
      prix: 300000,
      statutMandat: "actif",
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(suffixe: string, workspaceId = WORKSPACE_TEST, contactId?: string) {
  const acquereur = await creerAcquereur(
    {
      prenom: "Dossier",
      nom: `${M} ${suffixe}`,
      email: `visites-du-jour-${suffixe}-${Date.now()}@example.com`,
      telephone: "0600000000",
      budgetMin: 100000,
      budgetMax: 400000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      contactId,
    },
    workspaceId
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

async function planifiee(bienId: string, acquereurId: string, workspaceId = WORKSPACE_TEST, rendezVousCalendarId?: string) {
  const resultat = rendezVousCalendarId
    ? await materialiserVisite({ bienId, acquereurId, datePrevue: JOUR, rendezVousCalendarId }, workspaceId)
    : await creerVisite({ bienId, acquereurId, datePrevue: JOUR }, workspaceId);
  if (resultat.statut !== "creee") throw new Error(`visite attendue, reçu ${resultat.statut}`);
  return resultat.visite;
}

describe("visitesDuJour", () => {
  it("rend les Visites du jour avec bien et acquéreur joints, tous statuts, en une seule requête", async () => {
    const bien = await unBien("TOUS");
    const acquereur = await unAcquereur("TOUS");
    const native = await planifiee(bien.id, acquereur.id);
    const calendarBacked = await planifiee(bien.id, acquereur.id, WORKSPACE_TEST, `gcal-${M}`);
    const annulee = await planifiee(bien.id, acquereur.id);
    await annulerVisite(annulee.id, WORKSPACE_TEST);

    let requetes = 0;
    const db = getDb();
    const executeurCompteur = new Proxy(db, {
      get(cible, propriete, recepteur) {
        if (propriete === "select") requetes += 1;
        return Reflect.get(cible, propriete, recepteur);
      },
    });
    const resultat = (await visitesDuJour(WORKSPACE_TEST, JOUR, executeurCompteur as typeof db)).filter((v) => v.bienId === bien.id);

    expect(requetes).toBe(1);
    expect(resultat.map((v) => [v.id, v.statut, v.rendezVousCalendarId])).toEqual([
      [native.id, "planifiee", undefined],
      [calendarBacked.id, "planifiee", `gcal-${M}`],
      [annulee.id, "annulee", undefined],
    ]);
    expect(resultat[0].bien).toEqual({ id: bien.id, titre: bien.titre, adresse: "1 rue du Test", codePostal: "00000", ville: "Testville" });
    expect(resultat[0].acquereur).toEqual({ id: acquereur.id, nom: acquereur.nom, prenom: "Dossier" });
  });

  it("identité effective : le Contact rattaché fournit nom/prénom (ADR-057)", async () => {
    const contact = await creerContact({ nom: `${M} Contact`, prenom: "Canonique" }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const bien = await unBien("CONTACT");
    const acquereur = await unAcquereur("CONTACT", WORKSPACE_TEST, contact.id);
    await planifiee(bien.id, acquereur.id);

    const [visite] = (await visitesDuJour(WORKSPACE_TEST, JOUR)).filter((v) => v.bienId === bien.id);
    expect(visite.acquereur).toEqual({ id: acquereur.id, nom: contact.nom, prenom: "Canonique" });
  });

  it("workspace : les Visites d'un autre workspace sont invisibles", async () => {
    const autre = `ws-visites-du-jour-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] autre workspace visites du jour" });
    idsWorkspaces.push(autre);
    const bienB = await unBien("WS-B", autre);
    const acquereurB = await unAcquereur("WS-B", autre);
    const visiteB = await planifiee(bienB.id, acquereurB.id, autre);

    expect((await visitesDuJour(WORKSPACE_TEST, JOUR)).map((v) => v.id)).not.toContain(visiteB.id);
    expect((await visitesDuJour(autre, JOUR)).map((v) => v.id)).toEqual([visiteB.id]);
  });

  it("un autre jour : rien", async () => {
    const bien = await unBien("AUTRE-JOUR");
    const acquereur = await unAcquereur("AUTRE-JOUR");
    await planifiee(bien.id, acquereur.id);

    expect((await visitesDuJour(WORKSPACE_TEST, "2031-03-04")).filter((v) => v.bienId === bien.id)).toEqual([]);
  });
});
