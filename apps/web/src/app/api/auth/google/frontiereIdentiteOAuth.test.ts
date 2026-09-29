import { beforeEach, describe, expect, it, vi } from "vitest";

// WORKSPACE_SCOPING_V2D2 — le flux OAuth métier, vu sous l'angle de l'IDENTITÉ.
//
// Le state a toujours protégé contre le CSRF : il prouve que la réponse de Google appartient au flux
// que CE navigateur a lancé. Il ne prouvait pas que c'est la MÊME PERSONNE qui revient. Tant qu'une
// seule identité pouvait se connecter, les deux questions se confondaient ; avec plusieurs, elles
// divergent — et la conséquence d'une confusion n'est pas une erreur d'affichage : c'est un refresh
// token accordé par A enregistré sous l'identité de B, qui hérite alors de son agenda et de sa
// boîte Gmail.
//
// Le cookie de state porte donc désormais le `sub` initiateur, et le callback exige l'égalité avec
// la session courante. Chaque cas ci-dessous vérifie un refus AVANT tout échange de code.
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

const ecrireConnexionGoogleMock = vi.fn();
const lireConnexionGoogleMock = vi.fn();
const supprimerConnexionGoogleMock = vi.fn();
vi.mock("@/lib/google/connexion", () => ({
  ecrireConnexionGoogle: ecrireConnexionGoogleMock,
  lireConnexionGoogle: lireConnexionGoogleMock,
  supprimerConnexionGoogle: supprimerConnexionGoogleMock,
}));

const revoquerTokenMock = vi.fn();
vi.mock("@/lib/google/oauth", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/lib/google/oauth")>();
  return { ...reel, echangerCodeContreTokens: echangerCodeContreTokensMock, revoquerToken: revoquerTokenMock };
});

const ORIGINE = "https://domiora-production.up.railway.app";
const SUB_A = "sub-oauth-A";
const SUB_B = "sub-oauth-B";

async function ouvrirSession(sub: string) {
  const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
  await creerSessionAtlas({ sub, email: `${sub}@example.com` });
}

async function semerState(state: string, identiteSub: string) {
  const { ecrireStateTemporaire } = await import("@/lib/google/state");
  await ecrireStateTemporaire(state, identiteSub);
}

function urlCallback(params: Record<string, string>) {
  const url = new URL(`${ORIGINE}/api/auth/google/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function appelerCallback(params: Record<string, string>) {
  const { GET } = await import("./callback/route");
  return GET(new Request(urlCallback(params)));
}

beforeEach(() => {
  cookieStoreActuel = creerCookieStoreFactice();
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_REDIRECT_URI", `${ORIGINE}/api/auth/google/callback`);
  vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
  echangerCodeContreTokensMock.mockResolvedValue({ refreshToken: "refresh-neuf", scope: "calendar" });
});

describe("T10 — le callback écrit sous l'identité qui a initié le flux", () => {
  it("session A + state scellé pour A : la connexion est écrite pour A, jamais pour un autre", async () => {
    await ouvrirSession(SUB_A);
    await semerState("state-abc", SUB_A);

    const reponse = await appelerCallback({ code: "code-ok", state: "state-abc" });

    expect(ecrireConnexionGoogleMock).toHaveBeenCalledWith(SUB_A, "refresh-neuf", "calendar");
    expect(reponse.headers.get("location")).toBe(`${ORIGINE}/`);
  });
});

describe("Refus du flux OAuth — aucun token écrit", () => {
  it("state absent (aucun cookie) : refus", async () => {
    await ouvrirSession(SUB_A);

    const reponse = await appelerCallback({ code: "code-ok", state: "state-abc" });

    expect(ecrireConnexionGoogleMock).not.toHaveBeenCalled();
    expect(echangerCodeContreTokensMock).not.toHaveBeenCalled();
    expect(reponse.headers.get("location")).toBe(`${ORIGINE}/?google=erreur`);
  });

  it("state en désaccord avec le cookie : refus", async () => {
    await ouvrirSession(SUB_A);
    await semerState("state-cookie", SUB_A);

    const reponse = await appelerCallback({ code: "code-ok", state: "state-different" });

    expect(ecrireConnexionGoogleMock).not.toHaveBeenCalled();
    expect(echangerCodeContreTokensMock).not.toHaveBeenCalled();
    expect(reponse.headers.get("location")).toBe(`${ORIGINE}/?google=erreur`);
  });

  it("aucune session Atlas : refus, redirection vers la page de connexion", async () => {
    await semerState("state-abc", SUB_A);

    const reponse = await appelerCallback({ code: "code-ok", state: "state-abc" });

    expect(ecrireConnexionGoogleMock).not.toHaveBeenCalled();
    expect(reponse.headers.get("location")).toBe(`${ORIGINE}/connexion?erreur=connexion_echouee`);
  });

  it("Google renvoie une erreur : refus, aucun échange tenté", async () => {
    await ouvrirSession(SUB_A);
    await semerState("state-abc", SUB_A);

    await appelerCallback({ error: "access_denied", state: "state-abc" });

    expect(echangerCodeContreTokensMock).not.toHaveBeenCalled();
    expect(ecrireConnexionGoogleMock).not.toHaveBeenCalled();
  });

  // LE cas que ce lot ajoute. Le state est valide, la session est valide — et pourtant ce n'est pas
  // la même personne. Sans la vérification d'identité, le token accordé par A atterrirait chez B.
  it("session changée pendant le consentement : refus, ni A ni B ne reçoivent quoi que ce soit", async () => {
    await semerState("state-abc", SUB_A);
    await ouvrirSession(SUB_B);

    const reponse = await appelerCallback({ code: "code-ok", state: "state-abc" });

    expect(ecrireConnexionGoogleMock).not.toHaveBeenCalled();
    expect(echangerCodeContreTokensMock).not.toHaveBeenCalled();
    expect(reponse.headers.get("location")).toBe(`${ORIGINE}/?google=erreur`);
  });

  it("double callback avec le même state : le second est refusé (usage unique)", async () => {
    await ouvrirSession(SUB_A);
    await semerState("state-abc", SUB_A);

    await appelerCallback({ code: "code-ok", state: "state-abc" });
    expect(ecrireConnexionGoogleMock).toHaveBeenCalledTimes(1);

    const seconde = await appelerCallback({ code: "code-ok", state: "state-abc" });

    expect(ecrireConnexionGoogleMock).toHaveBeenCalledTimes(1);
    expect(seconde.headers.get("location")).toBe(`${ORIGINE}/?google=erreur`);
  });
});

describe("Deux flux OAuth concurrents — les identités ne se mélangent pas", () => {
  // Deux navigateurs, deux cookies : chacun revient avec SON state et SA session. Le fait que les
  // deux flux soient ouverts en même temps ne doit rien changer.
  it("A et B mènent chacun leur flux jusqu'au bout, chacun sous sa propre identité", async () => {
    const cookiesA = creerCookieStoreFactice();
    const cookiesB = creerCookieStoreFactice();

    cookieStoreActuel = cookiesA;
    await ouvrirSession(SUB_A);
    await semerState("state-de-A", SUB_A);

    cookieStoreActuel = cookiesB;
    await ouvrirSession(SUB_B);
    await semerState("state-de-B", SUB_B);

    cookieStoreActuel = cookiesA;
    echangerCodeContreTokensMock.mockResolvedValueOnce({ refreshToken: "token-de-A", scope: "calendar" });
    await appelerCallback({ code: "code-A", state: "state-de-A" });

    cookieStoreActuel = cookiesB;
    echangerCodeContreTokensMock.mockResolvedValueOnce({ refreshToken: "token-de-B", scope: "calendar" });
    await appelerCallback({ code: "code-B", state: "state-de-B" });

    expect(ecrireConnexionGoogleMock).toHaveBeenNthCalledWith(1, SUB_A, "token-de-A", "calendar");
    expect(ecrireConnexionGoogleMock).toHaveBeenNthCalledWith(2, SUB_B, "token-de-B", "calendar");
  });
});

describe("T5 (route) — la déconnexion ne révoque que son propre token", () => {
  it("logout sous la session A lit, révoque et supprime la connexion de A", async () => {
    await ouvrirSession(SUB_A);
    lireConnexionGoogleMock.mockResolvedValue({ refreshToken: "token-de-A", scope: "calendar" });

    const { POST } = await import("./logout/route");
    await POST(new Request(`${ORIGINE}/api/auth/google/logout`, { method: "POST" }));

    expect(lireConnexionGoogleMock).toHaveBeenCalledWith(SUB_A);
    expect(revoquerTokenMock).toHaveBeenCalledWith("token-de-A");
    expect(supprimerConnexionGoogleMock).toHaveBeenCalledWith(SUB_A);
  });

  it("logout anonyme : aucune révocation, aucune suppression", async () => {
    const { POST } = await import("./logout/route");
    const reponse = await POST(new Request(`${ORIGINE}/api/auth/google/logout`, { method: "POST" }));

    expect(reponse.status).toBe(401);
    expect(revoquerTokenMock).not.toHaveBeenCalled();
    expect(supprimerConnexionGoogleMock).not.toHaveBeenCalled();
  });
});
