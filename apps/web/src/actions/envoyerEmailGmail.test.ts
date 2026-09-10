import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ADR-047 : ces Server Actions exigent désormais une session Atlas. Le comportement métier
// (garde-fous existants, transactions) est testé ici en mockant exigerSessionAtlas() comme une
// session valide — la couverture exhaustive du refus anonyme est assurée séparément et
// structurellement par src/actions/gardeSessionAtlas.structurel.test.ts (chaque fonction exportée
// est vérifiée), jamais réintroduite ici fonction par fonction.
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

// ADR-054 — même raison que le mock de session juste au-dessus : ces tests portent sur le
// COMPORTEMENT MÉTIER de l'action, pas sur la résolution du périmètre (couverte par ses propres
// tests, src/lib/auth/workspaceCourant.test.ts). Sans ce mock, la résolution tenterait un bootstrap
// d'appartenance pour un `sub` fictif et dépendrait de l'allowlist. Le littéral est celui du
// workspace historique : ce que l'action écrit reste vérifié en base par les assertions.
vi.mock("@/lib/auth/workspaceCourant", () => ({
  exigerWorkspaceCourant: vi.fn().mockResolvedValue("default"),
}));
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { WORKSPACE_TEST } from "@/db/workspaceDeTest";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost:3000/api/auth/google/callback";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const { getDb } = await import("@/db/client");
const {
  contacts: contactsTable,
  envoisEmail: envoisEmailTable,
  interactions: interactionsTable,
  notesProspectVendeur: notesTable,
  prospectsVendeurs: prospectsVendeursTable,
  referencesExternes: referencesExternesTable,
} = await import("@/db/schema");
const { ecrireConnexionGoogle, supprimerConnexionGoogle } = await import("@/lib/google/connexion");
const { SCOPE_GMAIL_SEND } = await import("@/lib/google/oauth");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { creerContact } = await import("@/lib/contactRepository");
const { listerInteractionsDuContact } = await import("@/lib/interactionRepository");
const { listerNotesProspectVendeur } = await import("@/lib/noteProspectVendeurRepository");
const { getEnvoiEmailById } = await import("@/lib/envoiEmailRepository");
const { deriverEtatEnvoiEmail } = await import("@/types/envoiEmail");
const { envoyerEmailGmailAction } = await import("./envoyerEmailGmail");

const idsEnvois: string[] = [];
const idsProspects: string[] = [];
const idsContacts: string[] = [];

beforeAll(async () => {
  await ecrireConnexionGoogle("refresh-token-test", `https://www.googleapis.com/auth/calendar.events.readonly ${SCOPE_GMAIL_SEND}`);
});

afterAll(async () => {
  for (const id of idsEnvois) await getDb().delete(envoisEmailTable).where(eq(envoisEmailTable.id, id));
  for (const id of idsProspects) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
  for (const id of idsContacts) {
    const interactions = await getDb()
      .select({ id: interactionsTable.id })
      .from(interactionsTable)
      .where(eq(interactionsTable.contactId, id));
    for (const interaction of interactions) {
      await getDb()
        .delete(referencesExternesTable)
        .where(eq(referencesExternesTable.interactionId, interaction.id));
    }
    await getDb().delete(interactionsTable).where(eq(interactionsTable.contactId, id));
    await getDb().delete(contactsTable).where(eq(contactsTable.id, id));
  }
  await supprimerConnexionGoogle();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetchRoute(reponseEnvoi: () => Response | Promise<Response>) {
  const compteurEnvoi = { n: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u === TOKEN_URL) {
        return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600, scope: SCOPE_GMAIL_SEND }), {
          status: 200,
        });
      }
      if (u === SEND_URL) {
        compteurEnvoi.n += 1;
        return reponseEnvoi();
      }
      throw new Error("URL non mockée : " + u);
    })
  );
  return compteurEnvoi;
}

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) fd.set(cle, valeur);
  return fd;
}

describe("envoyerEmailGmailAction", () => {
  it("succès : envoi confirmé, ligne envoyee, interaction ADR-027 ajoutée pour un prospect vendeur", async () => {
    const prospect = await creerProspectVendeur({ nom: "Dupont" }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    mockFetchRoute(() => new Response(JSON.stringify({ id: "gmail-msg-succes" }), { status: 200 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Suivi de dossier",
      corps: "Bonjour,\n\nMerci.",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("envoye");
    const envoi = await getEnvoiEmailById(id);
    expect(deriverEtatEnvoiEmail(envoi!)).toBe("envoye");
    expect(envoi!.gmailMessageId).toBe("gmail-msg-succes");

    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes.some((n) => n.type === "email" && n.contenu.includes("Suivi de dossier"))).toBe(true);
  });

  it("scope Gmail absent -> échec explicite, aucune tentative démarrée", async () => {
    await supprimerConnexionGoogle();
    await ecrireConnexionGoogle("refresh-token-test", "https://www.googleapis.com/auth/calendar.events.readonly");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const id = randomUUID();
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
    }));

    expect(resultat.statut).toBe("echec");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getEnvoiEmailById(id)).resolves.toBeUndefined();

    // Restaure le scope Gmail pour les tests suivants.
    await ecrireConnexionGoogle("refresh-token-test", `https://www.googleapis.com/auth/calendar.events.readonly ${SCOPE_GMAIL_SEND}`);
  });

  it("échec Gmail (réponse HTTP reçue non-2xx) -> statut echec, aucune interaction ajoutée", async () => {
    const prospect = await creerProspectVendeur({ nom: "Martin" }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    mockFetchRoute(() => new Response("erreur", { status: 500 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("echec");
    const envoi = await getEnvoiEmailById(id);
    expect(deriverEtatEnvoiEmail(envoi!)).toBe("echec");
    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes).toHaveLength(0);
  });

  it("résultat incertain (rupture réseau) -> statut incertain, aucune interaction, aucun message de succès", async () => {
    const prospect = await creerProspectVendeur({ nom: "Petit" }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === TOKEN_URL) {
          return new Response(JSON.stringify({ access_token: "fake-access-token", expires_in: 3600, scope: SCOPE_GMAIL_SEND }), {
            status: 200,
          });
        }
        throw new TypeError("fetch failed");
      })
    );

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("incertain");
    const envoi = await getEnvoiEmailById(id);
    expect(deriverEtatEnvoiEmail(envoi!)).toBe("incertain");
    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes).toHaveLength(0);
  });

  it("retour_vendeur_apres_visite (ADR-042) : intention acceptée, persistée, interaction ADR-027 ajoutée pour le vendeur", async () => {
    const prospect = await creerProspectVendeur({ nom: "[test réel] Vendeur envoi ADR-042" }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    mockFetchRoute(() => new Response(JSON.stringify({ id: "gmail-msg-retour-vendeur" }), { status: 200 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "vendeur-adr042@test.local",
      objet: "Retour de visite — 5 rue de la Vente",
      corps: "Bonjour,\n\nRetour de visite.\n\nCordialement,",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
      origineIntention: "retour_vendeur_apres_visite",
    }));

    expect(resultat.statut).toBe("envoye");
    const envoi = await getEnvoiEmailById(id);
    expect(envoi!.origineIntention).toBe("retour_vendeur_apres_visite");
    // Même mécanisme générique ADR-027 que toute autre intention envoyée à un prospect vendeur —
    // aucune nouvelle table/booléen "retour effectué" nécessaire (ADR-042 §29/34).
    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes.some((n) => n.type === "email")).toBe(true);
  });

  it("bugfix pilote : refresh_token révoqué -> échec journalisé (étape=refresh_token), jamais de secret dans le log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url) === TOKEN_URL) {
          return new Response(
            JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
            { status: 400 }
          );
        }
        throw new Error("Gmail ne doit jamais être appelé si le refresh échoue");
      })
    );

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
    }));

    expect(resultat.statut).toBe("echec");
    if (resultat.statut === "echec") {
      expect(resultat.message).toBe("La connexion Gmail a expiré — reconnectez Gmail.");
    }
    const envoi = await getEnvoiEmailById(id);
    expect(deriverEtatEnvoiEmail(envoi!)).toBe("echec");

    const journalComplet = spy.mock.calls.map((appel) => appel.join(" ")).join("\n");
    expect(journalComplet).toContain("étape=refresh_token");
    expect(journalComplet).toContain("invalid_grant");
    expect(journalComplet).not.toContain("refresh-token-test");
    expect(journalComplet).not.toContain(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY);
    expect(journalComplet).not.toContain(process.env.GOOGLE_CLIENT_SECRET);
    spy.mockRestore();
  });

  it("double soumission avec la même clé d'idempotence : un seul appel Gmail réellement déclenché", async () => {
    const compteur = mockFetchRoute(() => new Response(JSON.stringify({ id: "gmail-msg-double" }), { status: 200 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const champs = formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
    });

    const [premier, second] = await Promise.all([
      envoyerEmailGmailAction(null, champs),
      envoyerEmailGmailAction(null, champs),
    ]);

    const statuts = [premier.statut, second.statut].sort();
    // L'un des deux a effectivement envoyé, l'autre a détecté le conflit d'idempotence — jamais
    // les deux "envoye" indépendamment, et surtout jamais deux appels Gmail réels.
    expect(statuts).toContain("envoye");
    expect(compteur.n).toBe(1);
  });
});


// ADR-055 §G + ADR-056 — la chaîne complète, depuis l'action : Gmail répond, l'audit technique est
// résolu, et le fait relationnel canonique naît de ce succès. Ce qui est vérifié ici et nulle part
// ailleurs, c'est le CHAÎNAGE : que rien de canonique ne s'écrive avant la réponse de Google, et
// que la date de l'interaction soit exactement celle de l'audit.
describe("envoyerEmailGmailAction — fait canonique et identité Gmail", () => {
  async function unProspectRattache(nom: string) {
    const contact = await creerContact({ nom: `[test réel] ${nom}` }, WORKSPACE_TEST);
    idsContacts.push(contact.id);
    const prospect = await creerProspectVendeur({ nom, contactId: contact.id }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    return { contact, prospect };
  }

  it("succès Gmail vers un destinataire rattaché : interaction email sortante + référence Gmail", async () => {
    const { contact, prospect } = await unProspectRattache("Canonique");
    const gmailMessageId = `gmail-msg-canonique-${randomUUID()}`;
    mockFetchRoute(() => new Response(JSON.stringify({ id: gmailMessageId }), { status: 200 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Suivi de dossier",
      corps: "Bonjour,\n\nMerci.",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("envoye");

    // L'audit technique reste intact et reste la source de vérité de l'envoi.
    const envoi = await getEnvoiEmailById(id);
    expect(deriverEtatEnvoiEmail(envoi!)).toBe("envoye");
    expect(envoi!.gmailMessageId).toBe(gmailMessageId);

    // Le fait relationnel, daté du MÊME instant que l'audit — pas d'une seconde lecture d'horloge.
    const interactions = await listerInteractionsDuContact(contact.id);
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ type: "email", sens: "sortant" });
    expect(interactions[0].survenuLe).toBe(envoi!.reussiLe);
    expect(interactions[0].contenu, "le corps n'est jamais recopié").toBeUndefined();

    // L'identité Gmail du message, sur l'interaction et sur rien d'autre.
    const [reference] = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(reference).toMatchObject({
      fournisseur: "gmail",
      typeEntiteExterne: "message",
      interactionId: interactions[0].id,
    });

    // La note ADR-027 existe TOUJOURS : le fait canonique ne remplace aucun flux historique.
    const notes = await listerNotesProspectVendeur(prospect.id);
    expect(notes.some((n) => n.type === "email")).toBe(true);
  });

  it("échec Gmail : aucune interaction, aucune identité externe", async () => {
    const { contact, prospect } = await unProspectRattache("Echec canonique");
    mockFetchRoute(() => new Response("erreur", { status: 500 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("echec");
    // Un email non parti n'est pas un échange : rien n'est affirmé.
    expect(await listerInteractionsDuContact(contact.id)).toEqual([]);
  });

  it("incertain (aucune réponse exploitable) : aucune interaction", async () => {
    // Sans identifiant de message fiable, il n'y a rien à rattacher — et surtout, on ne sait pas
    // si l'email est parti. Affirmer un échange serait inventer un fait.
    const { contact, prospect } = await unProspectRattache("Incertain canonique");
    mockFetchRoute(() => {
      throw new TypeError("fetch failed");
    });

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("incertain");
    expect(await listerInteractionsDuContact(contact.id)).toEqual([]);
  });

  it("destinataire non rattaché : l'envoi réussit, rien de canonique n'est inventé", async () => {
    const prospect = await creerProspectVendeur({ nom: "Non rattaché" }, WORKSPACE_TEST);
    idsProspects.push(prospect.id);
    const gmailMessageId = `gmail-msg-orphelin-${randomUUID()}`;
    mockFetchRoute(() => new Response(JSON.stringify({ id: gmailMessageId }), { status: 200 }));

    const id = randomUUID();
    idsEnvois.push(id);
    const resultat = await envoyerEmailGmailAction(null, formulaire({
      idempotencyKey: id,
      destinataireEmail: "sophie@test.local",
      objet: "Objet",
      corps: "Corps",
      destinataireType: "prospectVendeur",
      destinataireId: prospect.id,
    }));

    expect(resultat.statut).toBe("envoye");
    expect(deriverEtatEnvoiEmail((await getEnvoiEmailById(id))!)).toBe("envoye");
    const references = await getDb()
      .select()
      .from(referencesExternesTable)
      .where(eq(referencesExternesTable.idExterne, gmailMessageId));
    expect(references, "aucune identité externe sans cible canonique").toEqual([]);
  });
});
