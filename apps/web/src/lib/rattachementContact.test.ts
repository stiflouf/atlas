import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// ADR-055 §H — SUGGÉRER n'est pas RATTACHER. Ce fichier vérifie que le produit ne décide jamais
// seul que deux dossiers décrivent la même personne, et qu'un rattachement demandé par un humain
// est atomique, idempotent et confiné à son workspace.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  contacts: contactsTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerAcquereur, getClientById } = await import("@/lib/clientRepository");
const { creerProspectVendeur, getProspectVendeurById } = await import("@/lib/prospectVendeurRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { creerProjetAcquereur } = await import("@/lib/projetAcquereurRepository");
const { creerProjetVendeur } = await import("@/lib/projetVendeurRepository");
const {
  creerContactEtRattacherAcquereur,
  creerContactEtRattacherProspectVendeur,
  rattacherAcquereurAuContact,
  rattacherProspectVendeurAuContact,
  rechercherContactsCandidats,
} = await import("@/lib/rattachementContact");
const { versCandidatAcquereur } = await import("@/lib/communications/destinataireCommunication");

const EMAIL_LEGACY = "legacy@example.test";
const EMAIL_CANONIQUE = "canonique@example.test";

const idsAcquereurs: string[] = [];
const idsProspects: string[] = [];
const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsWorkspaces: string[] = [];

afterAll(async () => {
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsProspects.length > 0)
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  if (idsProjetsA.length > 0) {
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.projetAcquereurId, idsProjetsA));
    await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  }
  if (idsProjetsV.length > 0) {
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.projetVendeurId, idsProjetsV));
    await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  }
  if (idsContacts.length > 0) await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(nom: string, surcharge: Record<string, unknown> = {}, workspace = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `[test réel] ${nom}`, email: EMAIL_CANONIQUE, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

async function unAcquereurHistorique(suffixe: string, projetAcquereurId?: string, workspace = WORKSPACE_TEST) {
  const dossier = await creerAcquereur(
    {
      prenom: "Ancien",
      nom: `[test réel] Rattachement ${suffixe}`,
      email: EMAIL_LEGACY,
      telephone: "0600000000",
      budgetMin: 100_000,
      budgetMax: 400_000,
      criteres: [],
      stadeProjet: "recherche_active",
      notes: "",
      datePremiereContact: "2026-01-01",
      projetAcquereurId,
    },
    workspace
  );
  idsAcquereurs.push(dossier.id);
  return dossier;
}

async function unProspectHistorique(suffixe: string, projetVendeurId?: string) {
  const prospect = await creerProspectVendeur(
    {
      nom: `[test réel] Rattachement vendeur ${suffixe}`,
      prenom: "Ancien",
      email: EMAIL_LEGACY,
      telephone: "0600000000",
      origineLead: undefined,
      origineLeadDetail: undefined,
      adresseBienPotentiel: undefined,
      secteurBienPotentiel: undefined,
      ville: undefined,
      codePostal: undefined,
      typeBien: undefined,
      projetVendeurId,
    },
    WORKSPACE_TEST
  );
  idsProspects.push(prospect.id);
  return prospect;
}

async function unProjetAcquereur() {
  const projet = await creerProjetAcquereur(
    { budgetMin: 100_000, budgetMax: 400_000, criteres: [], stadeProjet: "decouverte" },
    WORKSPACE_TEST
  );
  idsProjetsA.push(projet.id);
  return projet;
}

async function unProjetVendeur() {
  const projet = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
  idsProjetsV.push(projet.id);
  return projet;
}

async function ligneAcquereur(id: string) {
  const [ligne] = await getDb().select().from(acquereursTable).where(eq(acquereursTable.id, id));
  return ligne!;
}

describe("rattachement — contact existant", () => {
  it("acquéreur historique : l'identité effective bascule immédiatement", async () => {
    const contact = await unContact("Cible acquereur");
    const dossier = await unAcquereurHistorique("acquereur");

    expect((await getClientById(dossier.id))?.email).toBe(EMAIL_LEGACY);

    const resultat = await rattacherAcquereurAuContact(dossier.id, contact.id, WORKSPACE_TEST);
    expect(resultat.statut).toBe("rattache");

    expect((await getClientById(dossier.id))?.email).toBe(EMAIL_CANONIQUE);
    // L'instantané legacy n'est JAMAIS réécrit : il reste ce que le dossier disait.
    expect((await ligneAcquereur(dossier.id)).email).toBe(EMAIL_LEGACY);
  });

  it("prospect vendeur historique : même bascule, même primitive", async () => {
    const contact = await unContact("Cible vendeur");
    const prospect = await unProspectHistorique("vendeur");

    expect((await getProspectVendeurById(prospect.id))?.email).toBe(EMAIL_LEGACY);
    expect((await rattacherProspectVendeurAuContact(prospect.id, contact.id, WORKSPACE_TEST)).statut).toBe("rattache");
    expect((await getProspectVendeurById(prospect.id))?.email).toBe(EMAIL_CANONIQUE);
  });

  it("Gmail suit sans une ligne de code spécifique", async () => {
    const contact = await unContact("Cible gmail");
    const dossier = await unAcquereurHistorique("gmail");

    expect(versCandidatAcquereur((await getClientById(dossier.id))!).email).toBe(EMAIL_LEGACY);
    await rattacherAcquereurAuContact(dossier.id, contact.id, WORKSPACE_TEST);
    expect(versCandidatAcquereur((await getClientById(dossier.id))!).email).toBe(EMAIL_CANONIQUE);
  });

  it("la partie de projet est créée quand un projet canonique existe, et une seule fois", async () => {
    const projet = await unProjetAcquereur();
    const contact = await unContact("Cible partie");
    const dossier = await unAcquereurHistorique("partie", projet.id);

    const resultat = await rattacherAcquereurAuContact(dossier.id, contact.id, WORKSPACE_TEST);
    expect(resultat).toMatchObject({ statut: "rattache", partieCreee: true });

    const parties = await getDb()
      .select()
      .from(partiesProjetTable)
      .where(eq(partiesProjetTable.projetAcquereurId, projet.id));
    expect(parties).toHaveLength(1);
    expect(parties[0]!.role).toBe("acquereur");
  });

  it("aucun projet canonique n'est fabriqué pour un dossier qui n'en a pas", async () => {
    // Ce lot canonicalise l'IDENTITÉ, pas le projet : inventer une intention immobilière que
    // personne n'a constatée serait fabriquer un fait.
    const contact = await unContact("Cible sans projet");
    const dossier = await unAcquereurHistorique("sans-projet");
    const projetsAvant = await getDb().select({ id: projetsAcquereurTable.id }).from(projetsAcquereurTable);

    const resultat = await rattacherAcquereurAuContact(dossier.id, contact.id, WORKSPACE_TEST);

    expect(resultat).toMatchObject({ statut: "rattache", partieCreee: false });
    expect((await ligneAcquereur(dossier.id)).projetAcquereurId).toBeNull();
    expect((await getDb().select({ id: projetsAcquereurTable.id }).from(projetsAcquereurTable)).length).toBe(
      projetsAvant.length
    );
  });
});

describe("rattachement — refus explicites", () => {
  it("un dossier DÉJÀ rattaché n'est jamais re-pointé en silence", async () => {
    const premier = await unContact("Premier");
    const second = await unContact("Second");
    const dossier = await unAcquereurHistorique("deja");

    await rattacherAcquereurAuContact(dossier.id, premier.id, WORKSPACE_TEST);
    const resultat = await rattacherAcquereurAuContact(dossier.id, second.id, WORKSPACE_TEST);

    expect(resultat).toEqual({ statut: "deja_rattache", contactId: premier.id });
    expect((await ligneAcquereur(dossier.id)).contactId).toBe(premier.id);
  });

  it("un contact d'un autre workspace est refusé", async () => {
    const autre = `test-rattachement-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre" });
    idsWorkspaces.push(autre);
    const contactEtranger = await unContact("Etranger", {}, autre);
    const dossier = await unAcquereurHistorique("workspace");

    expect((await rattacherAcquereurAuContact(dossier.id, contactEtranger.id, WORKSPACE_TEST)).statut).toBe(
      "workspaces_differents"
    );
    expect((await ligneAcquereur(dossier.id)).contactId).toBeNull();
  });

  it("un contact inexistant est refusé sans rien écrire", async () => {
    const dossier = await unAcquereurHistorique("contact-absent");
    expect(
      (await rattacherAcquereurAuContact(dossier.id, "00000000-0000-4000-8000-0000000000ff", WORKSPACE_TEST)).statut
    ).toBe("contact_introuvable");
    expect((await ligneAcquereur(dossier.id)).contactId).toBeNull();
  });

  it("deux rattachements CONCURRENTS : un seul gagne, l'autre reçoit un refus", async () => {
    // La garde vit dans le `WHERE ... contact_id IS NULL` : sans elle, les deux verraient un
    // dossier libre et le second écraserait la décision du premier.
    const premier = await unContact("Concurrent A");
    const second = await unContact("Concurrent B");
    const dossier = await unAcquereurHistorique("concurrence");

    const [a, b] = await Promise.all([
      rattacherAcquereurAuContact(dossier.id, premier.id, WORKSPACE_TEST),
      rattacherAcquereurAuContact(dossier.id, second.id, WORKSPACE_TEST),
    ]);

    const statuts = [a.statut, b.statut].sort();
    expect(statuts).toEqual(["deja_rattache", "rattache"]);
    const final = (await ligneAcquereur(dossier.id)).contactId;
    expect([premier.id, second.id]).toContain(final);
  });
});

describe("rattachement — création depuis l'historique", () => {
  it("crée UN contact à l'image du dossier, et le rattache, sans toucher le legacy", async () => {
    const dossier = await unAcquereurHistorique("creation");

    const resultat = await creerContactEtRattacherAcquereur(
      dossier.id,
      { nom: dossier.nom, prenom: dossier.prenom, email: dossier.email, telephone: dossier.telephone },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("rattache");
    if (resultat.statut !== "rattache") return;
    idsContacts.push(resultat.contact.id);

    expect(resultat.contact.email).toBe(EMAIL_LEGACY);
    expect((await ligneAcquereur(dossier.id)).contactId).toBe(resultat.contact.id);
    expect((await ligneAcquereur(dossier.id)).email).toBe(EMAIL_LEGACY);
    expect((await getClientById(dossier.id))?.email).toBe(EMAIL_LEGACY);
  });

  it("vendeur : même geste, même primitive", async () => {
    const prospect = await unProspectHistorique("creation");
    const resultat = await creerContactEtRattacherProspectVendeur(
      prospect.id,
      { nom: prospect.nom, prenom: prospect.prenom, email: prospect.email, telephone: prospect.telephone },
      WORKSPACE_TEST
    );
    expect(resultat.statut).toBe("rattache");
    if (resultat.statut === "rattache") idsContacts.push(resultat.contact.id);
  });

  it("AUCUNE fusion : un email identique ne fait pas une même personne", async () => {
    // LE test de doctrine. Un couple partage une adresse, une famille un numéro. Le coût d'une
    // fusion à tort dépasse celui d'un doublon, qui se corrige.
    const existant = await unContact("Homonyme", { email: "partage@example.test" });
    const dossier = await unAcquereurHistorique("partage");
    await getDb()
      .update(acquereursTable)
      .set({ email: "partage@example.test" })
      .where(eq(acquereursTable.id, dossier.id));

    const resultat = await creerContactEtRattacherAcquereur(
      dossier.id,
      { nom: "Autre personne", email: "partage@example.test" },
      WORKSPACE_TEST
    );

    expect(resultat.statut).toBe("rattache");
    if (resultat.statut !== "rattache") return;
    idsContacts.push(resultat.contact.id);
    // Un NOUVEAU contact, pas celui qui partage l'adresse.
    expect(resultat.contact.id).not.toBe(existant.id);
  });
});

describe("rattachement — multi-rôle et multi-projets", () => {
  it("un contact déjà acquéreur peut recevoir un ancien dossier vendeur", async () => {
    const contact = await unContact("Multi-role");
    const dossierAcquereur = await unAcquereurHistorique("multi-a");
    const prospect = await unProspectHistorique("multi-v");

    expect((await rattacherAcquereurAuContact(dossierAcquereur.id, contact.id, WORKSPACE_TEST)).statut).toBe("rattache");
    expect((await rattacherProspectVendeurAuContact(prospect.id, contact.id, WORKSPACE_TEST)).statut).toBe("rattache");

    // Une seule personne, deux rôles, une seule identité.
    expect((await getClientById(dossierAcquereur.id))?.email).toBe(EMAIL_CANONIQUE);
    expect((await getProspectVendeurById(prospect.id))?.email).toBe(EMAIL_CANONIQUE);
  });

  it("un contact peut porter PLUSIEURS projets acquéreur successifs", async () => {
    const contact = await unContact("Multi-projets");
    const projetA = await unProjetAcquereur();
    const projetB = await unProjetAcquereur();
    const dossierA = await unAcquereurHistorique("multi-p1", projetA.id);
    const dossierB = await unAcquereurHistorique("multi-p2", projetB.id);

    expect((await rattacherAcquereurAuContact(dossierA.id, contact.id, WORKSPACE_TEST)).statut).toBe("rattache");
    expect((await rattacherAcquereurAuContact(dossierB.id, contact.id, WORKSPACE_TEST)).statut).toBe("rattache");

    const parties = await getDb()
      .select()
      .from(partiesProjetTable)
      .where(inArray(partiesProjetTable.projetAcquereurId, [projetA.id, projetB.id]));
    expect(parties).toHaveLength(2);
  });

  it("un projet vendeur reçoit sa partie avec le rôle vendeur", async () => {
    const projet = await unProjetVendeur();
    const contact = await unContact("Partie vendeur");
    const prospect = await unProspectHistorique("partie", projet.id);

    expect((await rattacherProspectVendeurAuContact(prospect.id, contact.id, WORKSPACE_TEST)).statut).toBe("rattache");

    const parties = await getDb()
      .select()
      .from(partiesProjetTable)
      .where(eq(partiesProjetTable.projetVendeurId, projet.id));
    expect(parties).toHaveLength(1);
    expect(parties[0]!.role).toBe("vendeur");
  });
});

describe("candidats — une aide, jamais une décision", () => {
  it("cherche par nom, prénom, email et téléphone, dans le workspace courant seulement", async () => {
    const marqueur = `Candidat${Date.now()}`;
    const contact = await unContact(marqueur, { prenom: "Jeanne", telephone: "0788889999" });

    for (const requete of [marqueur, "Jeanne", EMAIL_CANONIQUE, "0788889999"]) {
      const trouves = await rechercherContactsCandidats(requete, WORKSPACE_TEST);
      expect(trouves.map((c) => c.id), requete).toContain(contact.id);
    }

    const autre = `test-candidats-${Date.now()}`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre candidats" });
    idsWorkspaces.push(autre);
    expect((await rechercherContactsCandidats(marqueur, autre)).map((c) => c.id)).not.toContain(contact.id);
  });

  it("une requête vide ne propose rien — jamais tout le carnet", async () => {
    expect(await rechercherContactsCandidats("", WORKSPACE_TEST)).toEqual([]);
    expect(await rechercherContactsCandidats("   ", WORKSPACE_TEST)).toEqual([]);
  });

  it("ADR-059 — un contact absorbé n'est ni candidat, ni destination de rattachement", async () => {
    const marqueur = `Absorbe${Date.now()}`;
    const survivant = await unContact(`${marqueur} survivant`);
    const absorbe = await unContact(`${marqueur} absorbé`);
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: survivant.id, fusionneLe: new Date() })
      .where(eq(contactsTable.id, absorbe.id));

    const ids = (await rechercherContactsCandidats(marqueur, WORKSPACE_TEST)).map((c) => c.id);
    expect(ids).toContain(survivant.id);
    expect(ids).not.toContain(absorbe.id);

    const dossier = await unAcquereurHistorique("vers absorbé");
    expect(await rattacherAcquereurAuContact(dossier.id, absorbe.id, WORKSPACE_TEST)).toEqual({ statut: "contact_introuvable" });
    expect((await ligneAcquereur(dossier.id)).contactId).toBeNull();

    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(eq(contactsTable.id, absorbe.id));
  });
});
