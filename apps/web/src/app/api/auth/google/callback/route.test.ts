import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bugfix déploiement Railway — même mécanisme et même correction que
// src/app/api/auth/atlas/callback/route.test.ts (voir son en-tête pour le contexte complet) :
// ce callback partage la même construction fautive `new URL(chemin, url.origin)` avant le fix.

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

const echangerCodeContreTokensMock = vi.fn();
vi.mock("@/lib/google/oauth", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/google/oauth")>();
  return { ...reel, echangerCodeContreTokens: echangerCodeContreTokensMock };
});

const ecrireConnexionGoogleMock = vi.fn();
vi.mock("@/lib/google/connexion", () => ({
  ecrireConnexionGoogle: ecrireConnexionGoogleMock,
}));

const ORIGINE_PUBLIQUE = "https://domiora-production.up.railway.app";
const URL_INTERNE = "http://localhost:8080/api/auth/google/callback";

async function seedSessionAtlas() {
  const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
  await creerSessionAtlas({ sub: "sub-1", email: "conseiller@example.com" });
}

async function seedStateGoogle(state: string) {
  const { ecrireStateTemporaire } = await import("@/lib/google/state");
  await ecrireStateTemporaire(state);
}

describe("GET /api/auth/google/callback — origine de redirection (bugfix déploiement)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("GOOGLE_REDIRECT_URI", `${ORIGINE_PUBLIQUE}/api/auth/google/callback`);
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
    echangerCodeContreTokensMock.mockReset();
    ecrireConnexionGoogleMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("aucune session Atlas : redirige vers l'origine publique, jamais l'origine interne de la requête", async () => {
    const { GET } = await import("./route");
    const reponse = await GET(new Request(`${URL_INTERNE}?state=x&code=y`));

    expect(reponse.status).toBe(307);
    const location = reponse.headers.get("location")!;
    expect(new URL(location).origin).toBe(ORIGINE_PUBLIQUE);
    expect(location).not.toContain("localhost");
  });

  it("autorisation réussie : la redirection finale vers « / » utilise l'origine publique, jamais localhost", async () => {
    await seedSessionAtlas();
    await seedStateGoogle("state-1");
    echangerCodeContreTokensMock.mockResolvedValue({ refreshToken: "rt-1", scope: "s" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`${URL_INTERNE}?state=state-1&code=code-1`));

    expect(reponse.status).toBe(307);
    expect(reponse.headers.get("location")).toBe(`${ORIGINE_PUBLIQUE}/`);
    expect(ecrireConnexionGoogleMock).toHaveBeenCalledWith("rt-1", "s");
  });

  it("développement local : GOOGLE_REDIRECT_URI localhost ⇒ redirection localhost (flux dev non cassé)", async () => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback");
    await seedSessionAtlas();
    await seedStateGoogle("state-1");
    echangerCodeContreTokensMock.mockResolvedValue({ refreshToken: "rt-1", scope: "s" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request("http://localhost:3000/api/auth/google/callback?state=state-1&code=code-1"));

    expect(reponse.headers.get("location")).toBe("http://localhost:3000/");
  });
});
