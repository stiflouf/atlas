import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bugfix déploiement Railway — reproduit exactement le symptôme observé en production : Google
// redirige bien le navigateur vers le domaine public (redirect_uri = GOOGLE_ATLAS_REDIRECT_URI),
// mais le processus Node voit une requête entrante dont request.url ne reflète PAS ce domaine
// public derrière le proxy Railway (Host réécrit en interne) — ici simulé par un `Request` dont
// l'URL pointe vers localhost, distinct de GOOGLE_ATLAS_REDIRECT_URI. Avant le fix, le
// NextResponse.redirect final utilisait `new URL(chemin, url.origin)` (request.url) : la
// redirection finale — et l'écran de la maquette derrière — devenait localhost/ERR_CONNECTION_REFUSED.
// Ce test échoue si ce mécanisme revient : il n'assert jamais un simple "ne throw pas", mais
// l'origine EXACTE du header Location.

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

const echangerCodeEtVerifierIdentiteMock = vi.fn();
vi.mock("@/lib/auth/googleIdentite", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/auth/googleIdentite")>();
  return { ...reel, echangerCodeEtVerifierIdentite: echangerCodeEtVerifierIdentiteMock };
});

const ORIGINE_PUBLIQUE = "https://domiora-production.up.railway.app";
// URL vue par le processus Node derrière le proxy Railway (reproduction du symptôme, pas une
// supposition arbitraire) — distincte à dessein de ORIGINE_PUBLIQUE.
const URL_INTERNE = "http://localhost:8080/api/auth/atlas/callback";

async function seedStateOidc(state: string, nonce: string) {
  const { ecrireStateOidcAtlas } = await import("@/lib/auth/atlasOidcState");
  await ecrireStateOidcAtlas(state, nonce);
}

describe("GET /api/auth/atlas/callback — origine de redirection (bugfix déploiement)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("GOOGLE_ATLAS_REDIRECT_URI", `${ORIGINE_PUBLIQUE}/api/auth/atlas/callback`);
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", "conseiller@example.com");
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
    echangerCodeEtVerifierIdentiteMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("state/nonce invalides : redirige vers l'origine publique, jamais l'origine interne de la requête", async () => {
    const { GET } = await import("./route");
    // Aucun state seedé ⇒ chargeAttendue undefined ⇒ branche de sortie précoce.
    const reponse = await GET(new Request(`${URL_INTERNE}?state=x&code=y`));

    expect(reponse.status).toBe(307);
    const location = reponse.headers.get("location")!;
    expect(new URL(location).origin).toBe(ORIGINE_PUBLIQUE);
    expect(location).not.toContain("localhost");
  });

  it("connexion réussie : la redirection finale vers « / » utilise l'origine publique, jamais localhost", async () => {
    await seedStateOidc("state-1", "nonce-1");
    echangerCodeEtVerifierIdentiteMock.mockResolvedValue({ sub: "sub-1", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`${URL_INTERNE}?state=state-1&code=code-1`));

    expect(reponse.status).toBe(307);
    const location = reponse.headers.get("location")!;
    expect(location).toBe(`${ORIGINE_PUBLIQUE}/`);
  });

  it("email non autorisé : redirige aussi vers l'origine publique, jamais localhost", async () => {
    await seedStateOidc("state-1", "nonce-1");
    echangerCodeEtVerifierIdentiteMock.mockResolvedValue({ sub: "sub-1", email: "intrus@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request(`${URL_INTERNE}?state=state-1&code=code-1`));

    const location = reponse.headers.get("location")!;
    expect(new URL(location).origin).toBe(ORIGINE_PUBLIQUE);
  });

  it("développement local : GOOGLE_ATLAS_REDIRECT_URI localhost ⇒ redirection localhost (flux dev non cassé)", async () => {
    vi.stubEnv("GOOGLE_ATLAS_REDIRECT_URI", "http://localhost:3000/api/auth/atlas/callback");
    await seedStateOidc("state-1", "nonce-1");
    echangerCodeEtVerifierIdentiteMock.mockResolvedValue({ sub: "sub-1", email: "conseiller@example.com" });

    const { GET } = await import("./route");
    const reponse = await GET(new Request("http://localhost:3000/api/auth/atlas/callback?state=state-1&code=code-1"));

    expect(reponse.headers.get("location")).toBe("http://localhost:3000/");
  });
});
