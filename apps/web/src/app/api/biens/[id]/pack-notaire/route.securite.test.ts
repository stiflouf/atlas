import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";

// ADR-047 — sécurité réelle (helper NON mocké ici, contrairement à route.test.ts).
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

function requetePost(bienId: string): Request {
  const formData = new FormData();
  formData.append("documentIds", "quelconque");
  return new Request(`http://localhost/api/biens/${bienId}/pack-notaire`, { method: "POST", body: formData });
}

describe("POST /api/biens/[id]/pack-notaire — sécurité (ADR-047)", () => {
  beforeEach(() => {
    cookieStoreActuel = creerCookieStoreFactice();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("anonyme (aucune session Atlas) reçoit un refus AVANT toute lecture du bien — aucun ZIP généré", async () => {
    const { POST } = await import("./route");
    const idBienInexistant = "00000000-0000-0000-0000-000000000000";
    await expect(
      POST(requetePost(idBienInexistant), { params: Promise.resolve({ id: idBienInexistant }) })
    ).rejects.toThrow(/non authentifié/i);
  });

  it("session Atlas valide conserve le comportement existant (404 sur un bien introuvable)", async () => {
    const { creerSessionAtlas } = await import("@/lib/auth/sessionAtlas");
    await creerSessionAtlas({ sub: "google-sub-123", email: "conseiller@example.com" });

    const { POST } = await import("./route");
    const idBienInexistant = "00000000-0000-0000-0000-000000000000";
    const reponse = await POST(requetePost(idBienInexistant), { params: Promise.resolve({ id: idBienInexistant }) });
    expect(reponse.status).toBe(404);
  });
});
