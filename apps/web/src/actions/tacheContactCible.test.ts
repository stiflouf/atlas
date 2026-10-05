import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

// TASK_CONTACT_TARGET_V1 (ADR-064) — une tâche peut cibler l'identité CANONIQUE elle-même.
//
// Ce que cette suite exerce, de bout en bout et sur une vraie base : la création structurée depuis
// le formulaire, la garde de périmètre, la garde de fusion à l'écriture, la résolution du
// destinataire à la lecture (y compris après fusion), et le silence total quand aucune adresse
// n'est connue. Ce qu'elle vérifie SURTOUT : qu'aucun destinataire n'apparaît jamais sans cible
// structurée — le titre et le contexte restent du texte libre que rien ne lit.
const { sessionMock, workspaceMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  workspaceMock: vi.fn(),
}));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceMock() }));

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  taches: tachesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact, marquerContactFusionne } = await import("@/lib/contactRepository");
const { creerTache, getTacheDuWorkspace } = await import("@/lib/tacheRepository");
const { creerTacheAction } = await import("./creerTache");
const { ETAT_FORMULAIRE_INITIAL } = await import("@/lib/formulaires/etatFormulaire");
const { resoudreContexteCommunicationDepuisTache, determinerIntentionParDefaut } = await import(
  "@/lib/communications/resoudreContexteCommunicationDepuisTache"
);
const { genererBrouillonEmail } = await import("@/lib/communications/genererBrouillonEmail");

const M = `Tct${Date.now()}`;
const WORKSPACE_B = `ws-tct-${Date.now()}`;
let workspaceBCree = false;
let compteur = 0;
const idsContacts: string[] = [];
const idsTaches: string[] = [];

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ sub: "tct-sub", email: "conseiller@example.test" });
  workspaceMock.mockReset().mockResolvedValue(WORKSPACE_TEST);
});

afterAll(async () => {
  if (idsTaches.length > 0) await getDb().delete(tachesTable).where(inArray(tachesTable.id, idsTaches));
  await getDb().delete(tachesTable).where(eq(tachesTable.titre, `${M} envoyer un mail`));
  if (idsContacts.length > 0) {
    // Les absorbés pointent leur survivant : le pointeur est retiré avant la suppression des lignes.
    await getDb()
      .update(contactsTable)
      .set({ fusionneDansContactId: null, fusionneLe: null })
      .where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (workspaceBCree) await getDb().delete(workspacesTable).where(eq(workspacesTable.id, WORKSPACE_B));
});

async function autreWorkspace() {
  if (!workspaceBCree) {
    await getDb().insert(workspacesTable).values({ id: WORKSPACE_B, nom: "[test réel] cible contact" });
    workspaceBCree = true;
  }
  return WORKSPACE_B;
}

async function unContact(workspaceId: string, options: { email?: string } = {}) {
  compteur += 1;
  const contact = await creerContact(
    { nom: `${M} Dupont ${compteur}`, prenom: "Jean", email: options.email, telephone: undefined },
    workspaceId
  );
  idsContacts.push(contact.id);
  return contact;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

// `creerTacheAction` redirige en cas de succès : la redirection de Next est une exception, donc un
// succès se lit ici comme un rejet dont le message est celui de `redirect()`. La preuve du succès
// reste la LIGNE en base, relue juste après.
async function soumettreCreation(champs: Record<string, string>) {
  return creerTacheAction(ETAT_FORMULAIRE_INITIAL, formulaire(champs)).catch((erreur) => erreur);
}

async function tacheCreee(titre: string) {
  const [ligne] = await getDb().select().from(tachesTable).where(eq(tachesTable.titre, titre)).limit(1);
  if (ligne) idsTaches.push(ligne.id);
  return ligne;
}

describe("TASK_CONTACT_TARGET_V1 — création d'une tâche ciblant un contact canonique", () => {
  it("T1/T2 — un contact du workspace est accepté, et la tâche relue porte exactement ce contact", async () => {
    const contact = await unContact(WORKSPACE_TEST, { email: `${M}.t1@example.test` });
    const titre = `${M} T1 envoyer un mail à Jean Dupont`;

    await soumettreCreation({ titre, type: "email", priorite: "normale", contactId: contact.id });

    const ligne = await tacheCreee(titre);
    expect(ligne).toBeDefined();
    expect(ligne!.contactId).toBe(contact.id);
    // Les huit autres cibles restent vides : un contact est une cible, pas un rattachement de plus.
    expect(ligne!.bienId).toBeNull();
    expect(ligne!.acquereurId).toBeNull();
    expect(ligne!.prospectVendeurId).toBeNull();

    const relue = await getTacheDuWorkspace(ligne!.id, WORKSPACE_TEST);
    expect(relue?.contactId).toBe(contact.id);
  });

  it("T3/T13 — un contact d'un AUTRE workspace est refusé, et le refus ne révèle pas son existence", async () => {
    const contactAilleurs = await unContact(await autreWorkspace());
    const titre = `${M} T3 tâche cross-workspace`;

    const etat = await soumettreCreation({
      titre,
      type: "email",
      priorite: "normale",
      contactId: contactAilleurs.id,
    });

    expect(etat).toMatchObject({ statut: "erreur", message: "Ce contact est introuvable." });
    // Message IDENTIQUE à celui d'un id inexistant : rien ne distingue les deux cas.
    const etatIdInconnu = await soumettreCreation({
      titre: `${M} T3 id inconnu`,
      type: "email",
      priorite: "normale",
      contactId: "00000000-0000-4000-8000-000000000000",
    });
    expect(etatIdInconnu).toMatchObject({ statut: "erreur", message: "Ce contact est introuvable." });
    // Aucune ligne écrite, dans aucun des deux workspaces.
    expect(await tacheCreee(titre)).toBeUndefined();
  });

  it("T12 — la garde de session passe avant toute écriture", async () => {
    sessionMock.mockRejectedValueOnce(new Error("session absente"));
    const contact = await unContact(WORKSPACE_TEST);
    const titre = `${M} T12 sans session`;

    await expect(
      creerTacheAction(
        ETAT_FORMULAIRE_INITIAL,
        formulaire({ titre, type: "email", priorite: "normale", contactId: contact.id })
      )
    ).rejects.toThrow("session absente");

    expect(await tacheCreee(titre)).toBeUndefined();
  });

  it("refuse une tâche portant un contact ET un autre type de cible à la fois", async () => {
    const contact = await unContact(WORKSPACE_TEST);
    const etat = await soumettreCreation({
      titre: `${M} deux cibles`,
      type: "email",
      priorite: "normale",
      contactId: contact.id,
      acquereurId: "00000000-0000-4000-8000-000000000001",
    });
    expect(etat).toMatchObject({ statut: "erreur", message: /une seule cible/ });
  });

  it("refuse de rattacher une tâche à un contact ABSORBÉ (ADR-059 §10)", async () => {
    const absorbe = await unContact(WORKSPACE_TEST);
    const survivant = await unContact(WORKSPACE_TEST);
    await getDb().transaction(async (tx) => {
      await marquerContactFusionne(absorbe.id, survivant.id, WORKSPACE_TEST, tx);
    });

    const titre = `${M} contact absorbé`;
    const etat = await soumettreCreation({ titre, type: "email", priorite: "normale", contactId: absorbe.id });

    expect(etat).toMatchObject({ statut: "erreur", message: /fusionné/ });
    expect(await tacheCreee(titre)).toBeUndefined();
  });
});

describe("TASK_CONTACT_TARGET_V1 — contexte de communication depuis une tâche contact", () => {
  it("T4/T5 — une tâche contact-only résout son destinataire, et son email est disponible", async () => {
    const email = `${M}.t5@example.test`;
    const contact = await unContact(WORKSPACE_TEST, { email });
    const tache = await creerTache(
      {
        titre: `${M} envoyer un mail`,
        type: "email",
        priorite: "normale",
        origine: "manuelle",
        cible: { type: "contact", id: contact.id },
      },
      WORKSPACE_TEST
    );
    idsTaches.push(tache.id);

    const contexte = await resoudreContexteCommunicationDepuisTache(tache, WORKSPACE_TEST);

    expect(contexte.cibleType).toBe("contact");
    expect(contexte.candidats).toEqual([
      { type: "contact", id: contact.id, nom: contact.nom, prenom: "Jean", email },
    ]);
    // L'intention n'affirme aucun dossier : ni projet de vente, ni acquisition.
    const intention = determinerIntentionParDefaut(contexte.cibleType, "contact", contexte.faits);
    expect(intention).toBe("message_contact");
    const brouillon = genererBrouillonEmail(intention, { destinataireNom: contact.nom, destinatairePrenom: "Jean" }, "professionnel", email);
    expect(brouillon.destinataireEmail).toBe(email);
    expect(brouillon.objet).toBe("");
    expect(brouillon.corps).toContain("Bonjour Jean,");
    expect(brouillon.corps).not.toMatch(/projet de vente|acquisition|visite|compromis/);
  });

  it("T6 — un contact SANS email ne fait inventer aucune adresse", async () => {
    const contact = await unContact(WORKSPACE_TEST);
    const tache = await creerTache(
      {
        titre: `${M} T6 appeler`,
        type: "appel",
        priorite: "normale",
        origine: "manuelle",
        cible: { type: "contact", id: contact.id },
      },
      WORKSPACE_TEST
    );
    idsTaches.push(tache.id);

    const contexte = await resoudreContexteCommunicationDepuisTache(tache, WORKSPACE_TEST);

    expect(contexte.candidats).toHaveLength(1);
    expect(contexte.candidats[0]!.email).toBeUndefined();
    const brouillon = genererBrouillonEmail("message_contact", {}, "professionnel", contexte.candidats[0]!.email);
    expect(brouillon.destinataireEmail).toBeUndefined();
  });

  it("T7 — une tâche SANS aucune cible ne propose toujours aucun destinataire, même avec un nom dans son titre", async () => {
    const tache = await creerTache(
      {
        titre: `${M} T7 envoyer un mail à Jean Dupont`,
        contexte: "jean.dupont@example.test",
        type: "email",
        priorite: "normale",
        origine: "manuelle",
      },
      WORKSPACE_TEST
    );
    idsTaches.push(tache.id);

    const contexte = await resoudreContexteCommunicationDepuisTache(tache, WORKSPACE_TEST);

    expect(contexte.cibleType).toBeUndefined();
    expect(contexte.candidats).toEqual([]);
  });

  it("T9 — après fusion, le destinataire résolu est l'identité canonique EFFECTIVE (le survivant)", async () => {
    const absorbe = await unContact(WORKSPACE_TEST, { email: `${M}.absorbe@example.test` });
    const survivant = await unContact(WORKSPACE_TEST, { email: `${M}.survivant@example.test` });
    const tache = await creerTache(
      {
        titre: `${M} T9 relancer`,
        type: "email",
        priorite: "normale",
        origine: "manuelle",
        cible: { type: "contact", id: absorbe.id },
      },
      WORKSPACE_TEST
    );
    idsTaches.push(tache.id);

    await getDb().transaction(async (tx) => {
      await marquerContactFusionne(absorbe.id, survivant.id, WORKSPACE_TEST, tx);
    });

    const contexte = await resoudreContexteCommunicationDepuisTache(tache, WORKSPACE_TEST);

    expect(contexte.candidats).toHaveLength(1);
    expect(contexte.candidats[0]!.id).toBe(survivant.id);
    expect(contexte.candidats[0]!.email).toBe(`${M}.survivant@example.test`);
    // La colonne de la tâche n'est PAS réécrite : la résolution est une lecture, pas une migration.
    expect((await getTacheDuWorkspace(tache.id, WORKSPACE_TEST))?.contactId).toBe(absorbe.id);
  });

  it("T13 — une tâche contact lue depuis un AUTRE workspace ne rend aucun destinataire", async () => {
    const contact = await unContact(WORKSPACE_TEST, { email: `${M}.t13@example.test` });
    const tache = await creerTache(
      {
        titre: `${M} T13 fuite`,
        type: "email",
        priorite: "normale",
        origine: "manuelle",
        cible: { type: "contact", id: contact.id },
      },
      WORKSPACE_TEST
    );
    idsTaches.push(tache.id);

    const contexte = await resoudreContexteCommunicationDepuisTache(tache, await autreWorkspace());

    expect(contexte.cibleType).toBe("contact");
    expect(contexte.candidats).toEqual([]);
  });
});

describe("TASK_CONTACT_TARGET_V1 — non-régression des tâches existantes", () => {
  it("T10 — une tâche historique sans contact_id reste valide et sans cible contact", async () => {
    const tache = await creerTache(
      { titre: `${M} T10 historique`, type: "autre", priorite: "normale", origine: "manuelle" },
      WORKSPACE_TEST
    );
    idsTaches.push(tache.id);

    expect(tache.contactId).toBeUndefined();
    const relue = await getTacheDuWorkspace(tache.id, WORKSPACE_TEST);
    expect(relue?.contactId).toBeUndefined();
  });
});
