import { afterEach, describe, expect, it, vi } from "vitest";

// Bugfix déploiement Railway — origineMetierPublique() doit dériver l'origine EXCLUSIVEMENT de
// GOOGLE_REDIRECT_URI, jamais d'une requête entrante (request.url/request.nextUrl), pour rester
// fiable derrière un proxy qui peut réécrire le Host vu par le processus Node (même mécanisme et
// même correction que googleIdentite.ts::origineIdentitePublique()).
describe("origineMetierPublique() — dérivée uniquement de GOOGLE_REDIRECT_URI", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("retourne l'origine HTTPS publique configurée en production", async () => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", "https://domiora-production.up.railway.app/api/auth/google/callback");
    const { origineMetierPublique } = await import("./oauth");
    expect(origineMetierPublique()).toBe("https://domiora-production.up.railway.app");
  });

  it("retourne localhost en développement (ne casse pas le flux local)", async () => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback");
    const { origineMetierPublique } = await import("./oauth");
    expect(origineMetierPublique()).toBe("http://localhost:3000");
  });

  it("variable absente : échoue explicitement, jamais un fallback silencieux", async () => {
    const { origineMetierPublique } = await import("./oauth");
    expect(() => origineMetierPublique()).toThrow(/GOOGLE_REDIRECT_URI/);
  });
});

// Bugfix pilote (envoi Gmail en échec sans aucune trace Railway) : rafraichirAccessToken() ne
// jetait auparavant qu'un statut HTTP nu — le couple {error, error_description} de Google
// (ex. invalid_grant), seul élément permettant de distinguer un refresh_token révoqué d'un autre
// échec, était lu par fetch() puis jeté sans jamais être exposé à l'appelant.
describe("rafraichirAccessToken() — diagnostic d'échec (bugfix pilote)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubEnvOAuth() {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id-test");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret-test");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback");
  }

  it("refresh_token révoqué (400 invalid_grant) : le message inclut error/error_description, jamais le refresh_token fourni", async () => {
    stubEnvOAuth();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), {
          status: 400,
        })
      )
    );
    const { rafraichirAccessToken } = await import("./oauth");
    const secretRefreshToken = "1//secret-refresh-token-ne-doit-jamais-apparaitre";
    await expect(rafraichirAccessToken(secretRefreshToken)).rejects.toThrow(
      /invalid_grant.*Token has been expired or revoked\./
    );
    try {
      await rafraichirAccessToken(secretRefreshToken);
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain(secretRefreshToken);
    }
  });

  it("échec HTTP sans corps JSON exploitable : message de repli avec uniquement le statut", async () => {
    stubEnvOAuth();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erreur serveur", { status: 500 })));
    const { rafraichirAccessToken } = await import("./oauth");
    await expect(rafraichirAccessToken("refresh-token")).rejects.toThrow(/HTTP 500/);
  });
});
