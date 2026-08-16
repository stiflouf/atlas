import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADR-047 — sécurité réelle (helper NON mocké ici, contrairement à route.test.ts) : même patron
// de magasin de cookies en mémoire que sessionAtlas.test.ts, nécessaire car next/headers.cookies()
// n'existe que dans un contexte de requête Next.js réel.
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

describe("GET /api/geocodage/communes — sécurité (ADR-047)", () => {
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

  it("anonyme (aucune session Atlas) reçoit un refus, jamais un appel au proxy IGN", async () => {
    const { GET } = await import("./route");
    await expect(GET(new Request("http://localhost/api/geocodage/communes?q=Houilles"))).rejects.toThrow(
      /non authentifié/i
    );
  });

  it("session Atlas valide autorise l'appel", async () => {
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request("http://localhost/api/geocodage/communes?q=H"));
    expect(reponse.status).toBe(200);
  });
});
