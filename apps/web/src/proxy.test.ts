import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// getIronSession est mocké ici (pas next/headers, non utilisé par proxy.ts — il lit les cookies
// directement depuis NextRequest) : ce test vérifie la logique de routage PRIVATE BY DEFAULT de
// src/proxy.ts, pas le scellement réel des cookies (déjà couvert par sessionAtlas.test.ts). Piloter
// directement ce que la session "contient" permet de tester séparément les cas anonyme/valide sans
// dépendre de la mécanique de cookie elle-même.
const getIronSessionMock = vi.fn();
vi.mock("iron-session", () => ({ getIronSession: getIronSessionMock }));

function requete(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, "http://localhost:3000"));
}

describe("proxy (ADR-047) — PRIVATE BY DEFAULT", () => {
  beforeEach(() => {
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "a".repeat(32));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    getIronSessionMock.mockReset();
  });

  it("anonyme sur / est redirigé vers /connexion", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/"));

    expect(reponse.status).toBe(307);
    expect(new URL(reponse.headers.get("location")!).pathname).toBe("/connexion");
  });

  it("anonyme sur /clients est redirigé vers /connexion", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/clients"));

    expect(new URL(reponse.headers.get("location")!).pathname).toBe("/connexion");
  });

  it("anonyme sur /biens est redirigé vers /connexion", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/biens"));

    expect(new URL(reponse.headers.get("location")!).pathname).toBe("/connexion");
  });

  it("/connexion reste accessible sans session", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/connexion"));

    expect(reponse.status).not.toBe(307);
    expect(reponse.headers.get("location")).toBeNull();
  });

  it("session Atlas valide laisse passer une page privée", async () => {
    getIronSessionMock.mockResolvedValue({ sub: "google-sub-123", email: "conseiller@example.com" });
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/clients"));

    expect(reponse.status).not.toBe(307);
    expect(reponse.headers.get("location")).toBeNull();
  });

  it("anonyme sur une route API privée reçoit un 401 explicite, jamais une redirection HTML", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/api/documents/00000000-0000-0000-0000-000000000000"));

    expect(reponse.status).toBe(401);
  });

  it.each([
    "/api/automatisations/scan",
    "/api/automatisations/reprise",
    "/api/compatibilite/scan",
    "/api/compatibilite/baseline",
  ])("%s atteint sa propre Route Handler sans session Atlas — la protection reste leur Bearer", async (chemin) => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete(chemin));

    // Le Proxy laisse passer (NextResponse.next()) : ni redirection, ni 401 posé par le Proxy
    // lui-même — la Route Handler applique ensuite son propre secret Bearer, vérifié séparément
    // (voir les routes elles-mêmes, protégées indépendamment de ce test).
    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("location")).toBeNull();
  });

  it("session absente à cause d'une configuration manquante (ATLAS_SESSION_PASSWORD) reste fail-closed", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ATLAS_SESSION_PASSWORD", "");
    getIronSessionMock.mockResolvedValue({ sub: "x", email: "y" }); // n'est jamais atteint : optionsSessionAtlas() lève avant
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/clients"));

    expect(new URL(reponse.headers.get("location")!).pathname).toBe("/connexion");
  });
});
