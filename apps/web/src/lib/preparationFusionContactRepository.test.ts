import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-059 — la PRÉPARATION d'une fusion : lecture pure de ce que l'écran montre. Périmètre strict,
// contacts actifs seulement, conflits champ par champ, impact compté sans double, avertissements
// par la même analyse que le moteur, verrous affichés — et jamais la similarité comme condition.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  champsVerrouilles: champsVerrouillesTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const { ajouterPartieProjet } = await import("@/lib/partieProjetRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { creerAcquereur } = await import("@/lib/clientRepository");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { enregistrerReferenceExterne } = await import("@/lib/provenance/referenceExterneRepository");
const { verrouillerChamp } = await import("@/lib/provenance/champVerrouilleRepository");
const { preparerFusionContacts } = await import("@/lib/preparationFusionContactRepository");

const M = `Zprep${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;

const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.contactId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
  }
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0)
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsContacts.length > 0) {
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0)
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0)
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (idsWorkspaces.length > 0)
    await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string } = {},
  workspace = WORKSPACE_TEST
) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unProjetAcquereur(contactId: string, role: "acquereur" | "co_acquereur" = "acquereur", projetId?: string) {
  const id =
    projetId ??
    (await creerProjetAcquereur({ budgetMin: 100_000, budgetMax: 300_000, criteres: [], stadeProjet: "recherche_active" }, WORKSPACE_TEST)).id;
  if (!projetId) idsProjetsA.push(id);
  await ajouterPartieProjet({ contactId, projetAcquereurId: id, role });
  return id;
}

async function unProjetVendeur(contactId: string) {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  await ajouterPartieProjet({ contactId, projetVendeurId: projet.id, role: "vendeur" });
  return projet.id;
}

const preparer = (s: string, a: string, workspace = WORKSPACE_TEST) =>
  preparerFusionContacts({ workspaceId: workspace, contactSurvivantId: s, contactAbsorbeId: a });

describe("preparerFusionContacts — accès", () => {
  it("A. deux contacts actifs du workspace : prêt, identités attendues avec modifieLe, champs par nature", async () => {
    const s = await unContact({ nom: `${M} Martin`, prenom: "Jean", email: unEmail() });
    const a = await unContact({ nom: `${M} Martin`, prenom: "Jean-Pierre", telephone: "0611111111" });
    const p = await preparer(s.id, a.id);
    expect(p.statut).toBe("pret");
    if (p.statut !== "pret") return;
    expect(p.survivant.identiteAttendue).toEqual({ nom: s.nom, prenom: "Jean", email: s.email, telephone: undefined, modifieLe: s.modifieLe });
    expect(p.absorbe.identiteAttendue).toEqual({ nom: a.nom, prenom: "Jean-Pierre", email: undefined, telephone: "0611111111", modifieLe: a.modifieLe });
    expect(p.champs).toEqual([
      { champ: "nom", valeurSurvivant: s.nom, valeurAbsorbe: a.nom, nature: "identique" },
      { champ: "prenom", valeurSurvivant: "Jean", valeurAbsorbe: "Jean-Pierre", nature: "conflit" },
      { champ: "email", valeurSurvivant: s.email, valeurAbsorbe: undefined, nature: "absence_comblee" },
      { champ: "telephone", valeurSurvivant: undefined, valeurAbsorbe: "0611111111", nature: "absence_comblee" },
    ]);
    expect(p.avertissements).toEqual([]);
  });

  it("B. autre workspace : contact_introuvable, sans dire lequel existe ailleurs", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre préparation" });
    idsWorkspaces.push(autre);
    const ici = await unContact();
    const ailleurs = await unContact({}, autre);
    expect(await preparer(ici.id, ailleurs.id)).toEqual({ statut: "contact_introuvable" });
    expect(await preparer(ailleurs.id, ici.id)).toEqual({ statut: "contact_introuvable" });
    expect(await preparer(ici.id, "00000000-0000-4000-8000-000000000000")).toEqual({ statut: "contact_introuvable" });
    expect(await preparer(ici.id, "pas-un-uuid")).toEqual({ statut: "contact_introuvable" });
  });

  it("C. self : meme_contact", async () => {
    const c = await unContact();
    expect(await preparer(c.id, c.id)).toEqual({ statut: "meme_contact" });
  });

  it("D. un des deux déjà absorbé : deja_fusionne, dans les deux sens", async () => {
    const s = await unContact();
    const a = await unContact();
    const tiers = await unContact();
    await getDb().update(contactsTable).set({ fusionneDansContactId: tiers.id, fusionneLe: new Date() }).where(eq(contactsTable.id, a.id));
    expect(await preparer(s.id, a.id)).toEqual({ statut: "deja_fusionne" });
    expect(await preparer(a.id, s.id)).toEqual({ statut: "deja_fusionne" });
  });

  it("N. deux contacts sans aucune coordonnée commune sont préparables : la similarité n'est pas une garde", async () => {
    const s = await unContact({ nom: `${M} Durand`, email: unEmail(), telephone: "0622222222" });
    const a = await unContact({ nom: `${M} Lefebvre`, email: unEmail(), telephone: "0633333333" });
    const p = await preparer(s.id, a.id);
    expect(p.statut).toBe("pret");
    expect(p.statut === "pret" && p.champs.filter((c) => c.nature === "conflit").map((c) => c.champ)).toEqual(["nom", "email", "telephone"]);
  });
});

describe("preparerFusionContacts — impact", () => {
  it("E/F/G. rôles dérivés, union des projets sans double compte, projets communs", async () => {
    const s = await unContact();
    const a = await unContact();
    const commun = await unProjetAcquereur(s.id, "co_acquereur");
    await unProjetAcquereur(a.id, "acquereur", commun);
    await unProjetAcquereur(s.id);
    await unProjetVendeur(a.id);
    const p = await preparer(s.id, a.id);
    if (p.statut !== "pret") throw new Error(p.statut);
    expect(p.survivant.roles).toEqual(["acquereur"]);
    expect(p.survivant.nbProjets).toBe(2);
    expect(p.absorbe.roles).toEqual(["acquereur", "vendeur"]);
    expect(p.absorbe.nbProjets).toBe(2);
    expect(p.impact.projetsConcernes).toBe(3);
    expect(p.impact.projetsCommuns).toBe(1);
  });

  it("H/I/J/K. interactions, dossiers acquéreur et vendeur, références : ceux de l'absorbé seulement", async () => {
    const s = await unContact();
    const a = await unContact();
    await creerInteraction({ contactId: s.id, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" });
    await creerInteraction({ contactId: a.id, type: "appel", sens: "entrant", survenuLe: "2026-03-02T10:00:00.000Z" });
    await creerInteraction({ contactId: a.id, type: "email", sens: "sortant", survenuLe: "2026-03-03T10:00:00.000Z" });
    for (const contactId of [s.id, a.id]) {
      const dossier = await creerAcquereur(
        { prenom: "L", nom: `${M} D`, email: unEmail(), telephone: "0600000000", budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active", notes: "", datePremiereContact: "2026-01-01", contactId },
        WORKSPACE_TEST
      );
      idsAcquereurs.push(dossier.id);
    }
    const prospect = await creerProspectVendeur(
      { nom: `${M} P`, prenom: undefined, email: undefined, telephone: undefined, origineLead: undefined, origineLeadDetail: undefined, adresseBienPotentiel: undefined, secteurBienPotentiel: undefined, ville: undefined, codePostal: undefined, typeBien: undefined, contactId: a.id },
      WORKSPACE_TEST
    );
    idsProspects.push(prospect.id);
    await enregistrerReferenceExterne({ fournisseur: "gmail", typeEntiteExterne: "message", idExterne: `${M}-s`, cible: { type: "contact", id: s.id } }, WORKSPACE_TEST);
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-a`, cible: { type: "contact", id: a.id } }, WORKSPACE_TEST);

    const p = await preparer(s.id, a.id);
    if (p.statut !== "pret") throw new Error(p.statut);
    expect(p.impact).toEqual({
      projetsConcernes: 0,
      projetsCommuns: 0,
      interactionsDeplacees: 2,
      dossiersAcquereurDeplaces: 1,
      dossiersVendeurDeplaces: 1,
      identifiantsExternesDeplaces: 1,
    });
    expect(p.avertissements).toEqual([]);
  });

  it("L. références contradictoires : même avertissement, même clé que le moteur", async () => {
    const s = await unContact();
    const a = await unContact();
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-111`, cible: { type: "contact", id: s.id } }, WORKSPACE_TEST);
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-222`, cible: { type: "contact", id: a.id } }, WORKSPACE_TEST);
    const p = await preparer(s.id, a.id);
    if (p.statut !== "pret") throw new Error(p.statut);
    expect(p.avertissements).toEqual([
      {
        cle: "reference_externe_contradictoire:playiad/contact",
        type: "reference_externe_contradictoire",
        fournisseur: "playiad",
        typeEntiteExterne: "contact",
        idsExternesSurvivant: [`${M}-111`],
        idsExternesAbsorbe: [`${M}-222`],
      },
    ]);
  });

  it("M. verrous humains : listés par champ et par contact", async () => {
    const s = await unContact({ email: unEmail() });
    const a = await unContact({ telephone: "0644444444" });
    await verrouillerChamp({ type: "contact", id: s.id }, "email", WORKSPACE_TEST);
    await verrouillerChamp({ type: "contact", id: a.id }, "telephone", WORKSPACE_TEST);
    await verrouillerChamp({ type: "contact", id: a.id }, "nom", WORKSPACE_TEST);
    const p = await preparer(s.id, a.id);
    if (p.statut !== "pret") throw new Error(p.statut);
    expect(p.survivant.champsModifiesManuellement).toEqual(["email"]);
    expect(p.absorbe.champsModifiesManuellement).toEqual(["nom", "telephone"]);
  });

  it("nombre de requêtes fixe, quel que soit le volume, et aucune écriture", async () => {
    const s = await unContact();
    const a = await unContact();
    for (let i = 0; i < 3; i++) await unProjetAcquereur(a.id);
    for (let i = 0; i < 3; i++) await creerInteraction({ contactId: a.id, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" });
    const db = getDb();
    const espion = vi.spyOn(db, "select");
    await preparerFusionContacts({ workspaceId: WORKSPACE_TEST, contactSurvivantId: s.id, contactAbsorbeId: a.id }, db);
    const n = espion.mock.calls.length;
    espion.mockRestore();
    expect(n).toBe(7);
    const [ligne] = await db.select().from(contactsTable).where(eq(contactsTable.id, a.id));
    expect(ligne.fusionneDansContactId).toBeNull();
  });
});
