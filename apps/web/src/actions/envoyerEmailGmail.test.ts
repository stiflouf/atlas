import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "test-client-secret";
process.env.GOOGLE_REDIRECT_URI ??= "http://localhost:3000/api/auth/google/callback";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const { getDb } = await import("@/db/client");
const { envoisEmail: envoisEmailTable, prospectsVendeurs: prospectsVendeursTable, notesProspectVendeur: notesTable } =
  await import("@/db/schema");
const { ecrireConnexionGoogle, supprimerConnexionGoogle } = await import("@/lib/google/connexion");
const { SCOPE_GMAIL_SEND } = await import("@/lib/google/oauth");
const { creerProspectVendeur } = await import("@/lib/prospectVendeurRepository");
const { listerNotesProspectVendeur } = await import("@/lib/noteProspectVendeurRepository");
const { getEnvoiEmailById } = await import("@/lib/envoiEmailRepository");
const { deriverEtatEnvoiEmail } = await import("@/types/envoiEmail");
const { envoyerEmailGmailAction } = await import("./envoyerEmailGmail");

const idsEnvois: string[] = [];
const idsProspects: string[] = [];

beforeAll(async () => {
  await ecrireConnexionGoogle("refresh-token-test", `https://www.googleapis.com/auth/calendar.events.readonly ${SCOPE_GMAIL_SEND}`);
});

afterAll(async () => {
  for (const id of idsEnvois) await getDb().delete(envoisEmailTable).where(eq(envoisEmailTable.id, id));
  for (const id of idsProspects) await getDb().delete(prospectsVendeursTable).where(eq(prospectsVendeursTable.id, id));
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
    const prospect = await creerProspectVendeur({ nom: "Dupont" });
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
    const prospect = await creerProspectVendeur({ nom: "Martin" });
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
    const prospect = await creerProspectVendeur({ nom: "Petit" });
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
