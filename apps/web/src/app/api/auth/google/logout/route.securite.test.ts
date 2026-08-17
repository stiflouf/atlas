import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR-047, §8 de la passe de fermeture : anonyme → aucune révocation, aucune suppression de
// connexion_google. Même patron que geocodage/communes/route.securite.test.ts (magasin de cookies
// en mémoire, helper NON mocké — sécurité réelle).
type CookieFactice = { name: string; value: string };
function creerCookieStoreFactice() {
  const cookies = new Map<string, CookieFactice>();
  return {
    get: (name: string) => cookies.get(name),
    set: (nomOuOptions: string | CookieFactice, valeur?: string) => {
      if (typeof nomOuOptions === "string") cookies.set(nomOuOptions, { name: nomOuOptions, value: valeur ?? "" });
      else cookies.set(nomOuOptions.name, nomOuOptions);
    },
    delete: (name: string) => cookies.delete(name),
  };
}
let cookieStoreActuel = creerCookieStoreFactice();
vi.mock("next/headers", () => ({ cookies: async () => cookieStoreActuel }));

describe("POST /api/auth/google/logout — sécurité (ADR-047)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("anonyme (aucune session Atlas) reçoit un refus explicite (401), aucune révocation ni mutation", async () => {
    const { POST } = await import("./route");
    const reponse = await POST(new Request("http://localhost/api/auth/google/logout", { method: "POST" }));

    expect(reponse.status).toBe(401);
    expect(await reponse.json()).toEqual({ erreur: "Non authentifié." });
    // revoquerToken() appelle l'API Google via fetch — jamais atteint avant la garde.
    expect(fetch).not.toHaveBeenCalled();
  });
});
