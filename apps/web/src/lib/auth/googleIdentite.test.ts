import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// google-auth-library est LA source de vérité pour la validation cryptographique de l'id_token
// (signature, émetteur, audience, expiration) — ce test ne la réimplémente jamais, il vérifie
// seulement que echangerCodeEtVerifierIdentite() exploite correctement son résultat (ADR-047, §29 :
// jamais un décodage JWT non vérifié). verifyIdToken est mocké ici précisément parce qu'un vrai
// appel réseau à Google est hors de portée d'un test unitaire — le comportement de la bibliothèque
// elle-même n'est pas ce qui est testé.
const verifyIdTokenMock = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: verifyIdTokenMock,
  })),
}));

function payloadParDefaut(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sub: "google-sub-123",
    email: "conseiller@example.com",
    email_verified: true,
    nonce: "nonce-attendu",
    aud: "client-id-atlas",
    iss: "https://accounts.google.com",
    iat: 0,
    exp: 0,
    ...overrides,
  };
}

describe("googleIdentite (ADR-047) — flux d'identité Atlas, distinct des scopes Calendar/Gmail", () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id-atlas");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret-atlas");
    vi.stubEnv("GOOGLE_ATLAS_REDIRECT_URI", "http://localhost:3000/api/auth/atlas/callback");
    verifyIdTokenMock.mockReset();
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id_token: "jwt-scelle-par-google" }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = fetchOriginal;
  });

  it("construireUrlAutorisationIdentite() ne demande que openid+email, jamais offline, jamais Calendar/Gmail", async () => {
    const { construireUrlAutorisationIdentite } = await import("./googleIdentite");
    const url = new URL(construireUrlAutorisationIdentite("state-1", "nonce-1"));

    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
  });

  it("identité valide (nonce correspondant, email vérifié) retourne exactement {sub, email}", async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => payloadParDefaut() });
    const { echangerCodeEtVerifierIdentite } = await import("./googleIdentite");

    await expect(echangerCodeEtVerifierIdentite("code-1", "nonce-attendu")).resolves.toEqual({
      sub: "google-sub-123",
      email: "conseiller@example.com",
    });
  });

  it("nonce ne correspondant pas au nonce attendu est rejeté (anti-rejeu)", async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => payloadParDefaut({ nonce: "nonce-different" }) });
    const { echangerCodeEtVerifierIdentite } = await import("./googleIdentite");

    await expect(echangerCodeEtVerifierIdentite("code-1", "nonce-attendu")).rejects.toThrow(/nonce/i);
  });

  it("audience invalide (rejetée par google-auth-library elle-même) échoue, jamais un fallback silencieux", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("Wrong recipient, payload audience != requiredAudience"));
    const { echangerCodeEtVerifierIdentite } = await import("./googleIdentite");

    await expect(echangerCodeEtVerifierIdentite("code-1", "nonce-attendu")).rejects.toThrow(/audience/i);
  });

  it("email absent du payload est rejeté", async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => payloadParDefaut({ email: undefined }) });
    const { echangerCodeEtVerifierIdentite } = await import("./googleIdentite");

    await expect(echangerCodeEtVerifierIdentite("code-1", "nonce-attendu")).rejects.toThrow(/email/i);
  });

  it("email explicitement non vérifié (email_verified: false) est rejeté", async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => payloadParDefaut({ email_verified: false }) });
    const { echangerCodeEtVerifierIdentite } = await import("./googleIdentite");

    await expect(echangerCodeEtVerifierIdentite("code-1", "nonce-attendu")).rejects.toThrow(/vérifié/i);
  });

  it("payload absent (id_token structurellement invalide) est rejeté", async () => {
    verifyIdTokenMock.mockResolvedValue({ getPayload: () => undefined });
    const { echangerCodeEtVerifierIdentite } = await import("./googleIdentite");

    await expect(echangerCodeEtVerifierIdentite("code-1", "nonce-attendu")).rejects.toThrow();
  });
});
