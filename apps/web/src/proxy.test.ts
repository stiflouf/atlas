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

// Régression ADR-052 : /brand/*.webp (PropertyVisual, sidebar) recevait un 307 vers /connexion —
// le fichier existait bien sur disque, mais aucune exclusion du matcher ne couvrait
// public/brand/*, donc le Proxy interceptait la requête AVANT même d'atteindre proxy() ci-dessus
// (le Proxy ne s'exécute jamais sur un chemin exclu par `config.matcher` — impossible à observer
// en appelant proxy() directement, contrairement aux tests "PRIVATE BY DEFAULT" plus haut, qui
// testent la logique interne une fois le Proxy déjà invoqué). Ce test compile le pattern regex
// réel de `config.matcher` (syntaxe regex directe, pas path-to-regexp — cf. commentaire dans
// proxy.ts) exactement comme Next.js l'utilise, pour vérifier explicitement quels chemins le
// déclenchent.
describe("config.matcher (ADR-052) — /brand/* public, routes privées inchangées", () => {
  async function matcherDeclenchePourLeProxy(pathname: string): Promise<boolean> {
    const { config } = await import("./proxy");
    const regex = new RegExp(`^${config.matcher[0]}$`);
    return regex.test(pathname);
  }

  it.each(["/brand/bien-maison.webp", "/brand/bien-appartement.webp", "/brand/sidebar-night-house.webp"])(
    "%s est exclu du matcher (public, jamais intercepté par le Proxy)",
    async (chemin) => {
      expect(await matcherDeclenchePourLeProxy(chemin)).toBe(false);
    }
  );

  it.each(["/clients", "/biens", "/api/photos-bien/00000000-0000-0000-0000-000000000000"])(
    "%s reste couvert par le matcher (le Proxy continue de s'exécuter dessus)",
    async (chemin) => {
      expect(await matcherDeclenchePourLeProxy(chemin)).toBe(true);
    }
  );
});
