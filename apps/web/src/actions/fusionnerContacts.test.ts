import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";
import type { ResultatFusionContacts } from "@/lib/fusionContactRepository";

// ADR-059 — la Server Action ORCHESTRE et n'écrit rien : session et workspace depuis le contexte,
// confirmation exigée, relecture serveur comme source de vérité des identités attendues, UN appel
// au moteur, redirection selon le résultat. Chaîne RÉELLE (DB de test) — le moteur n'est espionné
// que pour compter ses appels et forcer les résultats impossibles à provoquer autrement.
const { sessionMock, workspaceCourantMock, moteur } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  workspaceCourantMock: vi.fn(),
  moteur: { appels: 0, forcer: undefined as ResultatFusionContacts | undefined },
}));
vi.mock("@/lib/auth/sessionAtlas", () => ({ exigerSessionAtlas: () => sessionMock(), lireSessionAtlas: () => sessionMock() }));
vi.mock("@/lib/auth/workspaceCourant", () => ({ exigerWorkspaceCourant: () => workspaceCourantMock() }));
vi.mock("@/lib/fusionContactRepository", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/fusionContactRepository")>();
  return {
    ...original,
    fusionnerContacts: async (...args: Parameters<typeof original.fusionnerContacts>) => {
      moteur.appels += 1;
      if (moteur.forcer) return moteur.forcer;
      return original.fusionnerContacts(...args);
    },
  };
});

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";

const { getDb } = await import("@/db/client");
const {
  champsVerrouilles: champsVerrouillesTable,
  contactFusions: contactFusionsTable,
  contacts: contactsTable,
  interactions: interactionsTable,
  referencesExternes: referencesExternesTable,
  workspaces: workspacesTable,
} = await import("@/db/schema");
const { creerContact, modifierIdentiteContact } = await import("@/lib/contactRepository");
const { creerInteraction } = await import("@/lib/interactionRepository");
const { enregistrerReferenceExterne } = await import("@/lib/provenance/referenceExterneRepository");
const { chargerContactDetail } = await import("@/lib/contactDetailRepository");
const { fusionnerContactsAction } = await import("./fusionnerContacts");

const M = `Zactionfusion${Date.now()}`;
let compteur = 0;
const unEmail = () => `${M}.${++compteur}@example.test`;
const idsContacts: string[] = [];
const idsWorkspaces: string[] = [];

sessionMock.mockResolvedValue({ sub: "sub-action", email: "conseiller@example.test" });
workspaceCourantMock.mockResolvedValue(WORKSPACE_TEST);

beforeEach(() => {
  moteur.appels = 0;
  moteur.forcer = undefined;
});

afterAll(async () => {
  if (idsContacts.length > 0) {
    await getDb().delete(contactFusionsTable).where(inArray(contactFusionsTable.contactAbsorbeId, idsContacts));
    await getDb().delete(referencesExternesTable).where(inArray(referencesExternesTable.contactId, idsContacts));
    await getDb().delete(champsVerrouillesTable).where(inArray(champsVerrouillesTable.contactId, idsContacts));
    await getDb().delete(interactionsTable).where(inArray(interactionsTable.contactId, idsContacts));
    await getDb().update(contactsTable).set({ fusionneDansContactId: null, fusionneLe: null }).where(inArray(contactsTable.id, idsContacts));
    await getDb().delete(contactsTable).where(inArray(contactsTable.id, idsContacts));
  }
  if (idsWorkspaces.length > 0) await getDb().delete(workspacesTable).where(inArray(workspacesTable.id, idsWorkspaces));
});

async function unContact(
  surcharge: { nom?: string; prenom?: string; email?: string; telephone?: string } = {},
  workspace = WORKSPACE_TEST
) {
  const contact = await creerContact({ nom: `${M} Contact`, ...surcharge }, workspace);
  idsContacts.push(contact.id);
  return contact;
}

type Contact = Awaited<ReturnType<typeof unContact>>;

// Le formulaire tel que la page le rend : ids, dates vues, un choix par champ, confirmation.
function formulaire(
  s: Contact,
  a: Contact,
  surcharge: Record<string, string | string[] | undefined> = {},
  choix: Partial<Record<"nom" | "prenom" | "email" | "telephone", string>> = {}
): FormData {
  const fd = new FormData();
  const base: Record<string, string | string[] | undefined> = {
    survivantId: s.id,
    absorbeId: a.id,
    survivantModifieLe: s.modifieLe,
    absorbeModifieLe: a.modifieLe,
    confirmation: "oui",
    choix_nom: choix.nom ?? (s.nom === a.nom ? "identique" : "survivant"),
    choix_prenom: choix.prenom ?? (s.prenom === a.prenom ? "identique" : s.prenom === undefined || a.prenom === undefined ? "absence_comblee" : "survivant"),
    choix_email: choix.email ?? (s.email === a.email ? "identique" : s.email === undefined || a.email === undefined ? "absence_comblee" : "survivant"),
    choix_telephone:
      choix.telephone ?? (s.telephone === a.telephone ? "identique" : s.telephone === undefined || a.telephone === undefined ? "absence_comblee" : "survivant"),
    ...surcharge,
  };
  for (const [cle, valeur] of Object.entries(base)) {
    if (valeur === undefined) continue;
    for (const v of Array.isArray(valeur) ? valeur : [valeur]) fd.append(cle, v);
  }
  return fd;
}

// Une Server Action Next signale redirect()/notFound() par une exception porteuse d'un digest.
async function soumettre(fd: FormData): Promise<string> {
  try {
    await fusionnerContactsAction(fd);
    return "aucune";
  } catch (erreur) {
    return String((erreur as { digest?: string }).digest ?? (erreur as Error).message);
  }
}

const versComparaison = (s: Contact, a: Contact, code: string, champ?: string) =>
  `/contacts/${s.id}/fusionner/${a.id}?fusion=${code}${champ ? `&champ=${champ}` : ""}`;

async function estActif(id: string) {
  const [l] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, id));
  return l.fusionneDansContactId === null;
}

describe("fusionnerContactsAction — refus avant le moteur", () => {
  it("A. confirmation absente : redirection avec code, moteur non appelé, rien n'est écrit", async () => {
    const s = await unContact({ email: unEmail() });
    const a = await unContact({ email: unEmail() });
    const issue = await soumettre(formulaire(s, a, { confirmation: undefined }));
    expect(issue).toContain(versComparaison(s, a, "confirmation_requise"));
    expect(moteur.appels).toBe(0);
    expect(await estActif(a.id)).toBe(true);
  });

  it("M. aucun workspace depuis le formulaire : un champ workspaceId est ignoré, la session fait foi", async () => {
    const autre = `${M}-ws`;
    await getDb().insert(workspacesTable).values({ id: autre, nom: "[test réel] Autre action fusion" });
    idsWorkspaces.push(autre);
    const s = await unContact({}, autre);
    const a = await unContact({}, autre);
    const issue = await soumettre(formulaire(s, a, { workspaceId: autre }));
    expect(issue).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    expect(moteur.appels).toBe(0);
    expect(await estActif(a.id)).toBe(true);
  });

  it("D. contact introuvable, self ou id invalide : notFound(), moteur non appelé", async () => {
    const s = await unContact();
    expect(await soumettre(formulaire(s, { ...s, id: "00000000-0000-4000-8000-000000000000" }))).toMatch(/404|NOT_FOUND/);
    expect(await soumettre(formulaire(s, s))).toMatch(/404|NOT_FOUND/);
    expect(await soumettre(formulaire(s, { ...s, id: "pas-un-uuid" }))).toMatch(/404|NOT_FOUND/);
    expect(moteur.appels).toBe(0);
  });

  it("E. un des deux déjà fusionné à la relecture : deja_fusionne, moteur non appelé", async () => {
    const s = await unContact();
    const a = await unContact();
    const tiers = await unContact();
    await getDb().update(contactsTable).set({ fusionneDansContactId: tiers.id, fusionneLe: new Date() }).where(eq(contactsTable.id, a.id));
    expect(await soumettre(formulaire(s, a))).toContain(versComparaison(s, a, "deja_fusionne"));
    expect(moteur.appels).toBe(0);
  });

  it("F. identité modifiée après l'affichage (survivant, puis absorbé) : refus, aucune fusion", async () => {
    const s = await unContact({ prenom: "A", email: unEmail() });
    const a = await unContact({ prenom: "B", email: unEmail() });
    const fd = formulaire(s, a); // ce que la page a montré
    await modifierIdentiteContact(s.id, { nom: s.nom, prenom: "A corrigé", email: s.email }, WORKSPACE_TEST);
    expect(await soumettre(fd)).toContain(versComparaison(s, a, "identite_modifiee_entre_temps"));
    expect(moteur.appels).toBe(0);

    const s2 = await unContact({ prenom: "A", email: unEmail() });
    const a2 = await unContact({ prenom: "B", email: unEmail() });
    const fd2 = formulaire(s2, a2);
    await modifierIdentiteContact(a2.id, { nom: a2.nom, prenom: "B corrigé", email: a2.email }, WORKSPACE_TEST);
    expect(await soumettre(fd2)).toContain(versComparaison(s2, a2, "identite_modifiee_entre_temps"));
    expect(moteur.appels).toBe(0);
    expect(await estActif(a2.id)).toBe(true);
  });

  it("J. un choix manquant sur un champ en conflit : refus nommant le champ, moteur non appelé", async () => {
    const s = await unContact({ prenom: "A" });
    const a = await unContact({ prenom: "B" });
    expect(await soumettre(formulaire(s, a, { choix_prenom: undefined }))).toContain(versComparaison(s, a, "choix_manquant", "prenom"));
    expect(await soumettre(formulaire(s, a, { choix_prenom: "le_plus_recent" }))).toContain(versComparaison(s, a, "choix_manquant", "prenom"));
    expect(moteur.appels).toBe(0);
  });
});

describe("fusionnerContactsAction — moteur", () => {
  it("B/N/J/K/L. succès réel : choix et acquittements traduits, moteur appelé une fois, redirection vers le survivant", async () => {
    const s = await unContact({ nom: `${M} Conservé`, prenom: "Sam", email: unEmail() });
    const a = await unContact({ nom: `${M} Absorbé`, prenom: "Ana", email: unEmail(), telephone: "0677777777" });
    await creerInteraction({ contactId: a.id, type: "note", survenuLe: "2026-03-01T10:00:00.000Z" });
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-1`, cible: { type: "contact", id: s.id } }, WORKSPACE_TEST);
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-2`, cible: { type: "contact", id: a.id } }, WORKSPACE_TEST);

    const issue = await soumettre(
      formulaire(s, a, { acquittement: ["reference_externe_contradictoire:playiad/contact"] }, { nom: "absorbe", prenom: "survivant", email: "absorbe" })
    );
    expect(issue).toContain(`/contacts/${s.id}`);
    expect(issue).not.toContain("fusionner");
    expect(moteur.appels).toBe(1);

    const [survivant] = await getDb().select().from(contactsTable).where(eq(contactsTable.id, s.id));
    expect(survivant).toMatchObject({ nom: a.nom, prenom: "Sam", email: a.email, telephone: "0677777777", fusionneDansContactId: null });
    expect(await estActif(a.id)).toBe(false);
    const [journal] = await getDb().select().from(contactFusionsTable).where(eq(contactFusionsTable.contactAbsorbeId, a.id));
    expect(journal).toMatchObject({
      fusionneParSub: "sub-action",
      fusionneParEmail: "conseiller@example.test",
      choixParChamp: { nom: "absorbe", prenom: "survivant", email: "absorbe", telephone: "absence_comblee" },
      avertissementsAcquittes: ["reference_externe_contradictoire:playiad/contact"],
    });
    expect(journal.idsDeplaces.interactions).toHaveLength(1);
    // La fiche du survivant consolide ; celle de l'absorbé renvoie vers lui.
    expect((await chargerContactDetail(s.id, WORKSPACE_TEST))?.type).toBe("actif");
    expect(await chargerContactDetail(a.id, WORKSPACE_TEST)).toMatchObject({ type: "fusionne", contactActifId: s.id });
  });

  it("H. conflit de références sans acquittement : refus par le moteur, aucune fusion", async () => {
    const s = await unContact();
    const a = await unContact();
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-3`, cible: { type: "contact", id: s.id } }, WORKSPACE_TEST);
    await enregistrerReferenceExterne({ fournisseur: "playiad", typeEntiteExterne: "contact", idExterne: `${M}-4`, cible: { type: "contact", id: a.id } }, WORKSPACE_TEST);
    expect(await soumettre(formulaire(s, a))).toContain(versComparaison(s, a, "avertissement_requis"));
    expect(moteur.appels).toBe(1);
    expect(await estActif(a.id)).toBe(true);
    // Avec l'acquittement exact : fusion.
    expect(await soumettre(formulaire(s, a, { acquittement: "reference_externe_contradictoire:playiad/contact" }))).toContain(`/contacts/${s.id}`);
    expect(await estActif(a.id)).toBe(false);
  });

  it("I. acquittement inconnu : page périmée, aucune fusion", async () => {
    const s = await unContact();
    const a = await unContact();
    expect(await soumettre(formulaire(s, a, { acquittement: "reference_externe_contradictoire:hektor/contact" }))).toContain(
      versComparaison(s, a, "page_perimee")
    );
    expect(await estActif(a.id)).toBe(true);
  });

  it("C/D/E/F/G. résultats du moteur traduits en navigation, sans second appel", async () => {
    const s = await unContact({ prenom: "A" });
    const a = await unContact({ prenom: "B" });
    const cas: [ResultatFusionContacts, RegExp][] = [
      [{ statut: "meme_contact" }, /404|NOT_FOUND/],
      [{ statut: "contact_introuvable" }, /404|NOT_FOUND/],
      [{ statut: "deja_fusionne" }, new RegExp(`fusion=deja_fusionne`)],
      [{ statut: "identite_modifiee_entre_temps" }, /fusion=identite_modifiee_entre_temps/],
      [{ statut: "choix_identite_invalide", champ: "email" }, /fusion=choix_identite_invalide&champ=email/],
      [{ statut: "avertissement_reference_externe_requis", avertissements: [] }, /fusion=avertissement_requis/],
      [{ statut: "acquittement_inconnu", cles: ["x"] }, /fusion=page_perimee/],
    ];
    for (const [force, attendu] of cas) {
      moteur.forcer = force;
      moteur.appels = 0;
      expect(await soumettre(formulaire(s, a)), force.statut).toMatch(attendu);
      expect(moteur.appels, force.statut).toBe(1);
    }
    expect(await estActif(a.id)).toBe(true);
  });
});
