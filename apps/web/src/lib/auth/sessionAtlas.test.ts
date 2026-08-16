import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// next/headers.cookies() n'existe que dans un contexte de requête Next.js réel — hors périmètre
// d'un test Vitest classique. Même patron que le reste du projet pour tout code dépendant du
// runtime Next (aucun test existant n'exerce src/lib/google/state.ts pour la même raison) : on
// mocke le module pour fournir un magasin de cookies en mémoire, compatible avec l'interface
// CookieStore attendue par iron-session (get/set), suffisant pour vérifier le comportement réel de
// sessionAtlas.ts sans dépendre du serveur Next.js.
type CookieFactice = { name: string; value: string };

function creerCookieStoreFactice() {
  const cookies = new Map<string, CookieFactice>();
  return {
    get(name: string): CookieFactice | undefined {
      return cookies.get(name);
    },
    set(nomOuOptions: string | CookieFactice, valeur?: string): void {
      if (typeof nomOuOptions === "string") {
        cookies.set(nomOuOptions, { name: nomOuOptions, value: valeur ?? "" });
      } else {
        cookies.set(nomOuOptions.name, nomOuOptions);
      }
    },
    delete(name: string): void {
      cookies.delete(name);
    },
  };
}

let cookieStoreActuel = creerCookieStoreFactice();

vi.mock("next/headers", () => ({
  cookies: async () => cookieStoreActuel,
}));

describe("sessionAtlas (ADR-047)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("lireSessionAtlas() retourne undefined en l'absence de toute session", async () => {
    const { lireSessionAtlas } = await import("./sessionAtlas");
    await expect(lireSessionAtlas()).resolves.toBeUndefined();
  });

  it("exigerSessionAtlas() refuse en l'absence de session", async () => {
    const { exigerSessionAtlas } = await import("./sessionAtlas");
    await expect(exigerSessionAtlas()).rejects.toThrow(/non authentifié/i);
  });

  it("creerSessionAtlas() puis lireSessionAtlas()/exigerSessionAtlas() retrouvent exactement les données posées", async () => {
    const { creerSessionAtlas, lireSessionAtlas, exigerSessionAtlas } = await import("./sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    await expect(lireSessionAtlas()).resolves.toEqual({ sub: "google-sub-123", email: "conseiller@example.com" });
    await expect(exigerSessionAtlas()).resolves.toEqual({ sub: "google-sub-123", email: "conseiller@example.com" });
  });

  it("detruireSessionAtlas() efface la session — plus rien à lire ensuite", async () => {
    const { creerSessionAtlas, detruireSessionAtlas, lireSessionAtlas } = await import("./sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });
    await detruireSessionAtlas();

    await expect(lireSessionAtlas()).resolves.toBeUndefined();
  });

  it("fail-closed : ATLAS_SESSION_PASSWORD absent refuse plutôt que d'ouvrir silencieusement", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "");
    const { exigerSessionAtlas, lireSessionAtlas } = await import("./sessionAtlas");

    await expect(lireSessionAtlas()).rejects.toThrow();
    await expect(exigerSessionAtlas()).rejects.toThrow();
  });

  it("fail-closed : ATLAS_SESSION_PASSWORD trop court refuse (iron-session exige 32 caractères minimum)", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "trop-court");
    const { exigerSessionAtlas } = await import("./sessionAtlas");

    await expect(exigerSessionAtlas()).rejects.toThrow();
  });
});
