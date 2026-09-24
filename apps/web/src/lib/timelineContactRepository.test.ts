import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Contact } from "@/types/contact";

// CRM_TIMELINE_V1 — le read model « Historique » d'un Contact : fusion à la lecture des
// interactions canoniques et des notes legacy du journal vendeur, ordre métier, bornes, workspace,
// objet Gmail relu depuis `envois_email`, rapprochement Gmail ↔ note legacy CONSERVATEUR.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  acquereurs: acquereursTable,
  biens: biensTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  envoisEmail: envoisEmailTable,
  evenementsMetier: evenementsMetierTable,
  executionsAutomatisation: executionsAutomatisationTable,
  interactions: interactionsTable,
  notesProspectVendeur: notesProspectVendeurTable,
  partiesProjet: partiesProjetTable,
  projetsAcquereur: projetsAcquereurTable,
  projetsVendeur: projetsVendeurTable,
  prospectsVendeurs: prospectsVendeursTable,
  referencesExternes: referencesExternesTable,
  visites: visitesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { WORKSPACE_TEST } = await import("@/db/workspaceDeTest");
const { creerContact } = await import("./contactRepository");
const { creerBien } = await import("./bienRepository");
const { creerAcquereur } = await import("./clientRepository");
const { creerVisite } = await import("./visiteRepository");
const { creerProjetAcquereur } = await import("./projetAcquereurRepository");
const { creerProjetVendeur } = await import("./projetVendeurRepository");
const { ajouterPartieProjet } = await import("./partieProjetRepository");
const { creerProspectVendeur } = await import("./prospectVendeurRepository");
const { ajouterNoteProspectVendeur } = await import("./noteProspectVendeurRepository");
const { creerInteraction } = await import("./interactionRepository");
const { demarrerTentativeEnvoi, marquerEnvoiReussi, calculerContenuHash } = await import("./envoiEmailRepository");
const { enregistrerReferenceExterne } = await import("./provenance/referenceExterneRepository");
const { fusionnerContacts } = await import("./fusionContactRepository");
const { listerTimelineContact, listerContextesEchangeContact, parseCodeContexteEchange } = await import("./timelineContactRepository");
const { LIMITE_TIMELINE_MAX } = await import("@/types/timelineContact");

const M = `Ztimeline${Date.now()}`;
const WORKSPACE_B = `ws-timeline-b-${Date.now()}`;
let compteur = 0;
const idsContacts: string[] = [];
const idsProjetsA: string[] = [];
const idsProjetsV: string[] = [];
const idsProspects: string[] = [];
const idsAcquereurs: string[] = [];
const idsBiens: string[] = [];
const idsEnvois: string[] = [];
let workspaceBCree = false;

afterAll(async () => {
  if (idsBiens.length > 0) {
    const visites = (await getDb().select({ id: visitesTable.id }).from(visitesTable).where(inArray(visitesTable.bienId, idsBiens))).map((v) => v.id);
    if (visites.length > 0) {
      const evenements = (await getDb().select({ id: evenementsMetierTable.id }).from(evenementsMetierTable).where(inArray(evenementsMetierTable.visiteId, visites))).map((e) => e.id);
      if (evenements.length > 0) {
        await getDb().delete(executionsAutomatisationTable).where(inArray(executionsAutomatisationTable.evenementId, evenements));
        await getDb().delete(evenementsMetierTable).where(inArray(evenementsMetierTable.id, evenements));
      }
      await getDb().delete(interactionsTable).where(inArray(interactionsTable.visiteId, visites));
    }
  }
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    const interactionsDuLot = (await getDb().select({ id: interactionsTable.id }).from(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts))).map((i) => i.id);
    if (interactionsDuLot.length > 0) await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.interactionId, interactionsDuLot));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().delete(partiesProjetTable).where(inArray(partiesProjetTable.contactId, idsContacts));
  }
  if (idsProspects.length > 0) {
    await getDb().delete(notesProspectVendeurTable).where(inArray(notesProspectVendeurTable.prospectVendeurId, idsProspects));
    await getDb().delete(prospectsVendeursTable).where(inArray(prospectsVendeursTable.id, idsProspects));
  }
  if (idsEnvois.length > 0) await getDb().delete(envoisEmailTable).where(inArray(envoisEmailTable.id, idsEnvois));
  if (idsBiens.length > 0) await getDb().delete(biensTable).where(inArray(biensTable.id, idsBiens));
  if (idsAcquereurs.length > 0) await getDb().delete(acquereursTable).where(inArray(acquereursTable.id, idsAcquereurs));
  if (idsContacts.length > 0) {
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsProjetsA.length > 0) await getDb().delete(projetsAcquereurTable).where(inArray(projetsAcquereurTable.id, idsProjetsA));
  if (idsProjetsV.length > 0) await getDb().delete(projetsVendeurTable).where(inArray(projetsVendeurTable.id, idsProjetsV));
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function workspaceB() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] timeline B" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

async function unContact(nom: string, workspaceId = WORKSPACE_TEST) {
  const contact = await creerContact({ nom: `${M} ${nom}`, email: `${M}.${++compteur}@example.test` }, workspaceId);
  idsContacts.push(contact.id);
  return contact;
}

async function unProspect(contactId: string, workspaceId = WORKSPACE_TEST) {
  const prospect = await creerProspectVendeur({ nom: `${M} Prospect`, contactId }, workspaceId);
  idsProspects.push(prospect.id);
  return prospect;
}

async function uneNoteLegacy(prospectId: string, type: "appel" | "email" | "sms" | "rendez_vous" | "autre_interaction" | "note_interne", contenu: string, creeLe?: string) {
  const note = await ajouterNoteProspectVendeur(prospectId, type, contenu, WORKSPACE_TEST);
  if (creeLe) await getDb().update(notesProspectVendeurTable).set({ creeLe: new Date(creeLe) }).where(eq(notesProspectVendeurTable.id, note!.id));
  return note!;
}

async function unBien(workspaceId = WORKSPACE_TEST) {
  compteur += 1;
  const bien = await creerBien(
    {
      reference: `${M}-BIEN-${compteur}`,
      titre: "Appartement Timeline",
      type: "appartement",
      adresse: "3 rue de l'Historique",
      ville: "Testville",
      codePostal: "00000",
      surface: 60,
      pieces: 3,
      prix: 350000,
      statutMandat: "actif" as const,
      dateMandat: "2026-01-01",
      caracteristiques: [],
      description: "",
    },
    workspaceId
  );
  idsBiens.push(bien.id);
  return bien;
}

async function unAcquereur(contactId: string, projetAcquereurId?: string) {
  const acquereur = await creerAcquereur(
    { prenom: "A", nom: `${M} Acq`, email: `${M}.acq${++compteur}@example.test`, telephone: "0600000000", budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active", notes: "", datePremiereContact: "2026-01-01", contactId, projetAcquereurId },
    WORKSPACE_TEST
  );
  idsAcquereurs.push(acquereur.id);
  return acquereur;
}

// Un email Gmail RÉELLEMENT envoyé, tel que `finaliserEnvoiGmailReussi` le laisse : ligne
// `envois_email` réussie + interaction email/sortant + référence externe gmail/message.
async function unEnvoiGmail(contactId: string, objet: string, survenuLe: string, bienId?: string) {
  const gmailMessageId = `gm-${M}-${++compteur}`;
  const envoi = await demarrerTentativeEnvoi({
    id: crypto.randomUUID(),
    workspaceId: WORKSPACE_TEST,
    destinataireEmail: `${M}@example.test`,
    objet,
    contenuHash: calculerContenuHash(`${M}@example.test`, objet, "corps"),
    bienId,
  });
  idsEnvois.push(envoi!.id);
  await marquerEnvoiReussi(envoi!.id, gmailMessageId);
  const interaction = await creerInteraction({ contactId, type: "email", sens: "sortant", survenuLe });
  await enregistrerReferenceExterne(
    { fournisseur: "gmail", typeEntiteExterne: "message", idExterne: gmailMessageId, cible: { type: "interaction", id: interaction.id } },
    WORKSPACE_TEST
  );
  return interaction;
}

async function absorber(absorbe: Contact, survivant: Contact) {
  const identite = (c: Contact) => ({ nom: c.nom, prenom: c.prenom, email: c.email, telephone: c.telephone, modifieLe: c.modifieLe });
  const resultat = await fusionnerContacts({
    workspaceId: WORKSPACE_TEST,
    contactSurvivantId: survivant.id,
    contactAbsorbeId: absorbe.id,
    identiteAttendueSurvivant: identite(survivant),
    identiteAttendueAbsorbe: identite(absorbe),
    identiteFinale: { nom: survivant.nom, prenom: survivant.prenom, email: survivant.email, telephone: survivant.telephone },
    choixParChamp: { nom: "survivant", prenom: "identique", email: "survivant", telephone: "identique" },
    acteur: { sub: "test" },
  });
  if (resultat.statut !== "fusionne") throw new Error(`fusion attendue, reçu ${resultat.statut}`);
}

describe("listerTimelineContact — read model fusionné (intégration Postgres)", () => {
  it("fusionne interactions et notes legacy, du plus récent au plus ancien sur la date métier, avec contenu et libellés", async () => {
    const contact = await unContact("Ordre");
    const prospect = await unProspect(contact.id);
    await creerInteraction({ contactId: contact.id, type: "appel", sens: "entrant", survenuLe: "2026-03-01T10:00:00.000Z", contenu: "Appel du 1er mars" });
    await uneNoteLegacy(prospect.id, "appel", "Note legacy du 15 mars", "2026-03-15T10:00:00.000Z");
    await creerInteraction({ contactId: contact.id, type: "sms", sens: "sortant", survenuLe: "2026-04-01T10:00:00.000Z", contenu: "SMS du 1er avril" });
    // Enregistrée aujourd'hui mais survenue avant tout : c'est la date MÉTIER qui ordonne.
    await creerInteraction({ contactId: contact.id, type: "rendez_vous", survenuLe: "2026-01-10T10:00:00.000Z", contenu: "Rendez-vous de janvier" });

    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items.map((i) => i.contenu)).toEqual(["SMS du 1er avril", "Note legacy du 15 mars", "Appel du 1er mars", "Rendez-vous de janvier"]);
    expect(items.map((i) => i.source)).toEqual(["interaction", "note_legacy", "interaction", "interaction"]);
    expect(items[0]).toMatchObject({ type: "sms", sens: "sortant" });
    expect(items[1]).toMatchObject({ type: "appel", sens: undefined, contexte: { libelle: "Journal prospect vendeur", href: `/prospects-vendeurs/${prospect.id}` } });
    expect(items[3]).toMatchObject({ type: "rendez_vous", sens: undefined });
  });

  it("notes legacy : mapping des types (autre_interaction → message, note_interne → note/interne), aucun sens inventé", async () => {
    const contact = await unContact("Mapping");
    const prospect = await unProspect(contact.id);
    await uneNoteLegacy(prospect.id, "autre_interaction", "Croisé au marché", "2026-02-01T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "note_interne", "Penser au DPE", "2026-02-02T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "sms", "SMS legacy", "2026-02-03T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "rendez_vous", "RDV legacy", "2026-02-04T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "email", "Email legacy hors Gmail", "2026-02-05T10:00:00.000Z");

    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items.map((i) => [i.type, i.sens ?? null])).toEqual([
      ["email", null],
      ["rendez_vous", null],
      ["sms", null],
      ["note", "interne"],
      ["message", null],
    ]);
    expect(items.every((i) => i.source === "note_legacy")).toBe(true);
    // La note legacy porte `cree_le` comme date métier, la seule dont elle dispose.
    expect(items[0].survenuLe).toBe("2026-02-05T10:00:00.000Z");
  });

  it("retour vendeur post-visite : nature métier, contenu, et lien vers la visite avec son bien", async () => {
    const contact = await unContact("Retour vendeur");
    const bien = await unBien();
    const acquereur = await unAcquereur((await unContact("Visiteur")).id);
    const visite = await creerVisite({ bienId: bien.id, acquereurId: acquereur.id, datePrevue: "2026-06-01" }, WORKSPACE_TEST);
    if (visite.statut !== "creee") throw new Error("visite attendue");
    await creerInteraction({
      contactId: contact.id,
      type: "appel",
      sens: "sortant",
      survenuLe: "2026-06-02T10:00:00.000Z",
      contenu: "Le vendeur a trouvé les visiteurs sérieux.",
      visiteId: visite.visite.id,
      natureMetier: "retour_vendeur_post_visite",
    });

    const [item] = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(item.natureMetier).toBe("retour_vendeur_post_visite");
    expect(item.contenu).toBe("Le vendeur a trouvé les visiteurs sérieux.");
    expect(item.contexte).toEqual({ libelle: "Visite — Appartement Timeline — Testville", href: `/visites/${visite.visite.id}` });
  });

  it("contextes : bien → /biens, projet vendeur → dossier prospect, projet acquéreur → dossier client ; sans dossier, aucun lien fabriqué", async () => {
    const contact = await unContact("Contextes");
    const bien = await unBien();
    const projetV = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
    idsProjetsV.push(projetV.id);
    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projetV.id, role: "vendeur" });
    const prospect = await creerProspectVendeur({ nom: `${M} P`, contactId: contact.id, projetVendeurId: projetV.id }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    const projetA = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active" }, WORKSPACE_TEST);
    idsProjetsA.push(projetA.id);
    await ajouterPartieProjet({ contactId: contact.id, projetAcquereurId: projetA.id, role: "acquereur" });
    const projetASansDossier = await creerProjetAcquereur({ budgetMin: 1, budgetMax: 2, criteres: [], stadeProjet: "recherche_active" }, WORKSPACE_TEST);
    idsProjetsA.push(projetASansDossier.id);
    const dossier = await unAcquereur(contact.id, projetA.id);

    await creerInteraction({ contactId: contact.id, type: "appel", sens: "sortant", survenuLe: "2026-05-01T10:00:00.000Z", bienId: bien.id });
    await creerInteraction({ contactId: contact.id, type: "appel", sens: "sortant", survenuLe: "2026-05-02T10:00:00.000Z", projetVendeurId: projetV.id });
    await creerInteraction({ contactId: contact.id, type: "appel", sens: "sortant", survenuLe: "2026-05-03T10:00:00.000Z", projetAcquereurId: projetA.id });
    await creerInteraction({ contactId: contact.id, type: "appel", sens: "sortant", survenuLe: "2026-05-04T10:00:00.000Z", projetAcquereurId: projetASansDossier.id });

    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items.map((i) => i.contexte)).toEqual([
      undefined,
      { libelle: "Projet acquéreur", href: `/clients/${dossier.id}` },
      { libelle: "Projet vendeur", href: `/prospects-vendeurs/${prospect.id}` },
      { libelle: "Appartement Timeline — Testville", href: `/biens/${bien.id}` },
    ]);
  });

  it("objet Gmail : lu depuis envois_email via references_externes, sans contexte affirmé, avec repère vers le bien concerné", async () => {
    const contact = await unContact("Gmail sujet");
    const bien = await unBien();
    await unEnvoiGmail(contact.id, "Visite de samedi confirmée", "2026-07-01T10:00:00.000Z", bien.id);
    await unEnvoiGmail(contact.id, "Documents du dossier", "2026-07-02T10:00:00.000Z");

    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "email", sens: "sortant", sujet: "Documents du dossier", contenu: undefined, contexte: undefined });
    expect(items[1]).toMatchObject({ sujet: "Visite de samedi confirmée", contexte: { libelle: "Bien concerné", href: `/biens/${bien.id}` } });
  });

  it("bornes : chaque source est lue bornée, la fusion est tronquée à la limite, jamais au-delà de 200", async () => {
    const contact = await unContact("Bornes");
    const prospect = await unProspect(contact.id);
    for (let i = 0; i < 25; i += 1) {
      await creerInteraction({ contactId: contact.id, type: "appel", sens: "sortant", survenuLe: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, contenu: `I${i + 1}` });
      await uneNoteLegacy(prospect.id, "appel", `N${i + 1}`, `2026-01-${String(i + 1).padStart(2, "0")}T11:00:00.000Z`);
    }
    const vingt = await listerTimelineContact(contact.id, WORKSPACE_TEST, 20);
    expect(vingt).toHaveLength(20);
    // Les 20 plus récents TOUTES sources confondues : N25, I25, N24, I24, ...
    expect(vingt.map((i) => i.contenu).slice(0, 4)).toEqual(["N25", "I25", "N24", "I24"]);
    const quarante = await listerTimelineContact(contact.id, WORKSPACE_TEST, 40);
    expect(quarante).toHaveLength(40);
    expect(quarante[39].contenu).toBe("I6");
    const tout = await listerTimelineContact(contact.id, WORKSPACE_TEST, 1000);
    expect(tout).toHaveLength(50);
    expect(LIMITE_TIMELINE_MAX).toBe(200);
  });

  it("workspace : la timeline d'un contact du workspace B est vide depuis A, et une note legacy d'un prospect hors workspace est ignorée", async () => {
    const contactB = await unContact("Contact B", await workspaceB());
    await creerInteraction({ contactId: contactB.id, type: "appel", sens: "sortant", survenuLe: "2026-05-01T10:00:00.000Z", contenu: "Secret B" });
    expect(await listerTimelineContact(contactB.id, WORKSPACE_TEST)).toEqual([]);
    expect((await listerTimelineContact(contactB.id, WORKSPACE_B)).map((i) => i.contenu)).toEqual(["Secret B"]);
    expect(await listerContextesEchangeContact(contactB.id, WORKSPACE_TEST)).toEqual([]);
  });

  it("contact absorbé : sa timeline reste lisible telle quelle (sans redirection), les interactions déplacées appartiennent au survivant", async () => {
    const survivant = await unContact("Survivant");
    const absorbe = await unContact("Absorbé");
    await creerInteraction({ contactId: absorbe.id, type: "appel", sens: "sortant", survenuLe: "2026-05-01T10:00:00.000Z", contenu: "Avant fusion" });
    await absorber(absorbe, survivant);
    expect((await listerTimelineContact(survivant.id, WORKSPACE_TEST)).map((i) => i.contenu)).toEqual(["Avant fusion"]);
    expect(await listerTimelineContact(absorbe.id, WORKSPACE_TEST)).toEqual([]);
  });
});

describe("listerTimelineContact — rapprochement Gmail ↔ note legacy (conservateur)", () => {
  const OBJET = "Estimation de votre maison";

  it("A. un vrai envoi Gmail + sa note legacy au format exact, même objet, horodatages compatibles → un seul item, l'interaction", async () => {
    const contact = await unContact("Dedup A");
    const prospect = await unProspect(contact.id);
    await unEnvoiGmail(contact.id, OBJET, "2026-07-10T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "email", `Email envoyé — Objet : ${OBJET}`, "2026-07-10T10:00:02.000Z");
    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: "interaction", sujet: OBJET });
  });

  it("B. objets différents, même minute → deux items (la fenêtre de temps seule ne rapproche jamais)", async () => {
    const contact = await unContact("Dedup B");
    const prospect = await unProspect(contact.id);
    await unEnvoiGmail(contact.id, OBJET, "2026-07-10T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "email", "Email envoyé — Objet : Compromis à signer", "2026-07-10T10:00:02.000Z");
    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.source).sort()).toEqual(["interaction", "note_legacy"]);
  });

  it("C. même objet mais horodatages incompatibles (> 10 min) → deux items", async () => {
    const contact = await unContact("Dedup C");
    const prospect = await unProspect(contact.id);
    await unEnvoiGmail(contact.id, OBJET, "2026-07-10T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "email", `Email envoyé — Objet : ${OBJET}`, "2026-07-10T11:00:00.000Z");
    expect(await listerTimelineContact(contact.id, WORKSPACE_TEST)).toHaveLength(2);
  });

  it("D. une note email legacy hors format Gmail, ou une interaction email sans envoi Gmail réel → jamais rapprochées", async () => {
    const contact = await unContact("Dedup D");
    const prospect = await unProspect(contact.id);
    await unEnvoiGmail(contact.id, OBJET, "2026-07-10T10:00:00.000Z");
    await uneNoteLegacy(prospect.id, "email", `Envoyé un mail : ${OBJET}`, "2026-07-10T10:00:01.000Z");
    // Interaction email manuelle (aucune référence Gmail) + note legacy au format Gmail, même objet, même instant.
    await creerInteraction({ contactId: contact.id, type: "email", sens: "sortant", survenuLe: "2026-07-11T10:00:00.000Z", contenu: `Objet : ${OBJET}` });
    await uneNoteLegacy(prospect.id, "email", `Email envoyé — Objet : ${OBJET}`, "2026-07-11T10:00:00.000Z");
    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items).toHaveLength(4);
  });

  it("E. deux vrais envois proches au même objet + deux notes → deux items exactement (une note par interaction), deux emails proches préservés", async () => {
    const contact = await unContact("Dedup E");
    const prospect = await unProspect(contact.id);
    await unEnvoiGmail(contact.id, OBJET, "2026-07-10T10:00:00.000Z");
    await unEnvoiGmail(contact.id, OBJET, "2026-07-10T10:03:00.000Z");
    await uneNoteLegacy(prospect.id, "email", `Email envoyé — Objet : ${OBJET}`, "2026-07-10T10:00:01.000Z");
    await uneNoteLegacy(prospect.id, "email", `Email envoyé — Objet : ${OBJET}`, "2026-07-10T10:03:01.000Z");
    const items = await listerTimelineContact(contact.id, WORKSPACE_TEST);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.source === "interaction" && i.sujet === OBJET)).toBe(true);
    // Trois notes pour deux envois : la troisième n'a rien à consommer, elle reste visible.
    await uneNoteLegacy(prospect.id, "email", `Email envoyé — Objet : ${OBJET}`, "2026-07-10T10:04:00.000Z");
    expect(await listerTimelineContact(contact.id, WORKSPACE_TEST)).toHaveLength(3);
  });
});

describe("listerContextesEchangeContact / parseCodeContexteEchange", () => {
  it("propose uniquement les contextes réellement reliés au contact (projets actifs, biens non archivés), avec des codes parsables", async () => {
    const contact = await unContact("Contextes options");
    const projetV = await creerProjetVendeur({ origineLead: undefined, origineLeadDetail: undefined }, WORKSPACE_TEST);
    idsProjetsV.push(projetV.id);
    await ajouterPartieProjet({ contactId: contact.id, projetVendeurId: projetV.id, role: "vendeur" });
    const prospect = await creerProspectVendeur({ nom: `${M} P`, contactId: contact.id, projetVendeurId: projetV.id, ville: "Lyon" }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    const bien = await unBien();
    await getDb().update(prospectsVendeursTable).set({ bienId: bien.id }).where(eq(prospectsVendeursTable.id, prospect.id));
    const sansLien = await unBien();

    const contextes = await listerContextesEchangeContact(contact.id, WORKSPACE_TEST);
    expect(contextes).toEqual([
      { code: `projetVendeur:${projetV.id}`, kind: "projetVendeur", id: projetV.id, libelle: "Projet vendeur — Lyon" },
      { code: `bien:${bien.id}`, kind: "bien", id: bien.id, libelle: "Bien — Appartement Timeline (Testville)" },
    ]);
    expect(contextes.some((c) => c.id === sansLien.id)).toBe(false);
    expect(parseCodeContexteEchange(contextes[0].code)).toEqual({ kind: "projetVendeur", id: projetV.id });
    expect(parseCodeContexteEchange("bien:pas-un-uuid")).toBeUndefined();
    expect(parseCodeContexteEchange("visite:00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });
});
