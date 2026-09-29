import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

// WORKSPACE_SCOPING_V2D2 (ADR-054 §6) — la frontière de COMPTE GOOGLE, qui n'est pas celle du
// workspace. Un refresh token appartient à la personne qui l'a accordé : deux conseillers ont deux
// comptes, deux agendas, deux boîtes mail. Jusqu'à ce lot `connexions_google` était un singleton
// d'instance (`id = 'default'`) — une seule ligne, donc aucune requête ne pouvait distinguer deux
// personnes, et la dernière connexion écrasait la précédente.
//
// Ce fichier exerce la couche de persistance sur une VRAIE base, avec deux identités simultanées.
// Le flux OAuth (state lié au `sub`, changement de session, rejeu) est couvert séparément par
// src/app/api/auth/google/frontiereIdentiteOAuth.test.ts, qui a besoin de mocks de cookies.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas_test";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
// Exigées par `rafraichirAccessToken` (oauth.ts). Valeurs factices : `fetch` est toujours mocké
// dans ce fichier, aucun appel ne sort.
process.env.GOOGLE_CLIENT_ID ??= "client-id-de-test";
process.env.GOOGLE_CLIENT_SECRET ??= "client-secret-de-test";

const { getDb } = await import("@/db/client");
const { connexionsGoogle } = await import("@/db/schema");
const { lireConnexionGoogle, ecrireConnexionGoogle, supprimerConnexionGoogle } = await import("./connexion");

const SUB_A = `sub-v2d1-A-${Date.now()}`;
const SUB_B = `sub-v2d1-B-${Date.now()}`;
const TOKEN_A = "refresh-token-de-A";
const TOKEN_B = "refresh-token-de-B";
const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.events.readonly";
const SCOPE_GMAIL = "https://www.googleapis.com/auth/gmail.send";

afterAll(async () => {
  await getDb().delete(connexionsGoogle).where(inArray(connexionsGoogle.identiteSub, [SUB_A, SUB_B]));
});

beforeEach(async () => {
  await getDb().delete(connexionsGoogle).where(inArray(connexionsGoogle.identiteSub, [SUB_A, SUB_B]));
});

async function connecterLesDeux() {
  await ecrireConnexionGoogle(SUB_A, TOKEN_A, SCOPE_CALENDAR);
  await ecrireConnexionGoogle(SUB_B, TOKEN_B, `${SCOPE_CALENDAR} ${SCOPE_GMAIL}`);
}

describe("T1–T3 — deux connexions simultanées, jamais confondues", () => {
  it("T1 — A et B connectent chacun leur compte : deux lignes distinctes", async () => {
    await connecterLesDeux();

    const lignes = await getDb()
      .select()
      .from(connexionsGoogle)
      .where(inArray(connexionsGoogle.identiteSub, [SUB_A, SUB_B]));
    expect(lignes).toHaveLength(2);
    // Les secrets sont chiffrés en base : deux chiffrés distincts, aucun token en clair.
    const chiffres = lignes.map((l) => l.refreshTokenChiffre);
    expect(new Set(chiffres).size).toBe(2);
    expect(chiffres.join(" ")).not.toContain(TOKEN_A);
    expect(chiffres.join(" ")).not.toContain(TOKEN_B);
  });

  it("T2 — lire(A) rend le token de A, jamais celui de B", async () => {
    await connecterLesDeux();
    const connexionA = await lireConnexionGoogle(SUB_A);
    expect(connexionA?.refreshToken).toBe(TOKEN_A);
    expect(connexionA?.scope).toBe(SCOPE_CALENDAR);
  });

  it("T3 — lire(B) rend le token de B, avec SES scopes", async () => {
    await connecterLesDeux();
    const connexionB = await lireConnexionGoogle(SUB_B);
    expect(connexionB?.refreshToken).toBe(TOKEN_B);
    expect(connexionB?.scope).toContain(SCOPE_GMAIL);
  });

  it("une identité sans connexion est introuvable, même quand d'autres sont connectées", async () => {
    await connecterLesDeux();
    expect(await lireConnexionGoogle(`${SUB_A}-inexistant`)).toBeUndefined();
  });
});

describe("T4 — refresh : le bon token est LU", () => {
  // `rafraichirAccessToken` est stateless (aucune persistance, oauth.ts) : ce qui peut mal tourner
  // n'est pas l'écriture mais la LECTURE — se voir remettre le refresh token d'un autre.
  it("le refresh token remis à l'échange est celui de l'identité demandée", async () => {
    await connecterLesDeux();
    const { rafraichirAccessToken } = await import("./oauth");

    const appels: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: URLSearchParams }) => {
        appels.push(String(init.body.get("refresh_token")));
        return { ok: true, json: async () => ({ access_token: "at", expires_in: 3600 }) } as unknown as Response;
      })
    );

    const connexionA = await lireConnexionGoogle(SUB_A);
    await rafraichirAccessToken(connexionA!.refreshToken);

    expect(appels).toEqual([TOKEN_A]);
    expect(appels).not.toContain(TOKEN_B);
    vi.unstubAllGlobals();
  });
});

describe("T5/T6 — déconnexion et reconnexion isolées", () => {
  it("T5 — supprimer(A) ne touche pas B", async () => {
    await connecterLesDeux();

    await supprimerConnexionGoogle(SUB_A);

    expect(await lireConnexionGoogle(SUB_A)).toBeUndefined();
    // La contre-épreuve est le cœur du cas : avant ce lot, le DELETE était global.
    expect((await lireConnexionGoogle(SUB_B))?.refreshToken).toBe(TOKEN_B);
  });

  it("T6 — B reconnecte avec un nouveau token : sa ligne est remplacée, celle de A intacte", async () => {
    await connecterLesDeux();

    await ecrireConnexionGoogle(SUB_B, "nouveau-token-de-B", `${SCOPE_CALENDAR} ${SCOPE_GMAIL}`);

    expect((await lireConnexionGoogle(SUB_B))?.refreshToken).toBe("nouveau-token-de-B");
    expect((await lireConnexionGoogle(SUB_A))?.refreshToken).toBe(TOKEN_A);
    // Toujours une seule ligne par personne : l'upsert remplace, il n'empile pas.
    const lignesB = await getDb().select().from(connexionsGoogle).where(eq(connexionsGoogle.identiteSub, SUB_B));
    expect(lignesB).toHaveLength(1);
  });

  it("une connexion de A ne peut pas écraser celle de B (le défaut exact du singleton)", async () => {
    await connecterLesDeux();
    await ecrireConnexionGoogle(SUB_A, "token-A-v2", SCOPE_CALENDAR);
    expect((await lireConnexionGoogle(SUB_B))?.refreshToken).toBe(TOKEN_B);
  });
});

describe("Capacités Google — personnelles, jamais d'instance", () => {
  it("A n'hérite pas du scope Gmail autorisé par B", async () => {
    await connecterLesDeux();
    const { chargerCapacitesGoogle } = await import("./capacites");

    const capacitesA = await chargerCapacitesGoogle(SUB_A);
    expect(capacitesA.calendarAutorise).toBe(true);
    expect(capacitesA.gmailAutorise).toBe(false);

    const capacitesB = await chargerCapacitesGoogle(SUB_B);
    expect(capacitesB.gmailAutorise).toBe(true);
  });

  it("une identité non connectée n'a aucune capacité, même si quelqu'un d'autre est connecté", async () => {
    await connecterLesDeux();
    const { chargerCapacitesGoogle } = await import("./capacites");
    expect(await chargerCapacitesGoogle("sub-sans-connexion")).toEqual({
      calendarAutorise: false,
      gmailAutorise: false,
    });
  });
});

describe("Agenda — l'agenda de son propre compte", () => {
  it("T7/T8 (couche token) — getAgendaSemaine(A) utilise le token de A", async () => {
    await connecterLesDeux();
    const { getAgendaSemaine } = await import("./agendaSource");

    const tokensUtilises: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          tokensUtilises.push(String(init!.body!.get("refresh_token")));
          return { ok: true, json: async () => ({ access_token: "at-test", expires_in: 3600 }) } as unknown as Response;
        }
        return { ok: true, json: async () => ({ items: [] }) } as unknown as Response;
      })
    );

    await getAgendaSemaine(SUB_A);
    expect(tokensUtilises).toEqual([TOKEN_A]);

    tokensUtilises.length = 0;
    await getAgendaSemaine(SUB_B);
    expect(tokensUtilises).toEqual([TOKEN_B]);

    vi.unstubAllGlobals();
  });
});

describe("T7/T8 — /preparer : l'événement est lu dans l'agenda de la session", () => {
  // La porte Google de /preparer est `getRendezVousAvecContexte`. La tester directement plutôt que
  // de rendre la page : ce qui doit être prouvé ici est le TOKEN employé, pas le HTML produit — et
  // `workspaceId`/`identiteSub` y sont deux paramètres distincts, précisément pour que la donnée
  // DOMIORA et le compte Google ne puissent pas être confondus.
  it("le contexte d'un rendez-vous est récupéré avec le token de l'identité passée", async () => {
    await connecterLesDeux();
    const { getRendezVousAvecContexte } = await import("@/lib/rendezVousContexte");

    const tokensUtilises: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          tokensUtilises.push(String(init!.body!.get("refresh_token")));
          return { ok: true, json: async () => ({ access_token: "at-test", expires_in: 3600 }) } as unknown as Response;
        }
        // Événement introuvable : le contexte n'a pas d'importance ici, seul le token en a.
        return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      })
    );

    await getRendezVousAvecContexte("gcal-evenement-test", "default", SUB_A);
    expect(tokensUtilises).toEqual([TOKEN_A]);

    tokensUtilises.length = 0;
    await getRendezVousAvecContexte("gcal-evenement-test", "default", SUB_B);
    expect(tokensUtilises).toEqual([TOKEN_B]);

    vi.unstubAllGlobals();
  });
});
