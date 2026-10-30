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

  // FIX_GOOGLE_OAUTH_CALLBACK_PROXY_V1 — LE cas de ce lot. Google redirige le navigateur sur ce
  // callback ; intercepté ici, un retour sans session recevait un 401 JSON brut, sans redirection
  // et sans log, et le handler n'avait jamais la main pour nommer la cause.
  it("le callback OAuth métier atteint son handler sans session — le Proxy ne pose ni 401 ni redirection", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/api/auth/google/callback"));

    expect(reponse.status).toBe(200);
    expect(reponse.status).not.toBe(401);
    expect(reponse.headers.get("location")).toBeNull();
  });

  it("le callback OAuth métier passe aussi avec une session valide", async () => {
    getIronSessionMock.mockResolvedValue({ sub: "google-sub-123", email: "conseiller@example.com" });
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/api/auth/google/callback"));

    expect(reponse.status).toBe(200);
    expect(reponse.headers.get("location")).toBeNull();
  });

  // Ce lot ouvre le RETOUR, jamais le DÉPART : initier une autorisation Google reste réservé à un
  // conseiller déjà authentifié (ADR-047). Si l'un de ces deux chemins devenait public, un visiteur
  // anonyme pourrait déclencher un flux de consentement pour l'instance.
  it.each(["/api/auth/google/login", "/api/auth/google/gmail/login", "/api/auth/google/logout"])(
    "%s reste privé : le Proxy refuse un anonyme",
    async (chemin) => {
      getIronSessionMock.mockResolvedValue({});
      const { proxy } = await import("./proxy");
      const reponse = await proxy(requete(chemin));

      expect(reponse.status).toBe(401);
    }
  );

  // Épinglage délibéré : /api/retention/dry-run souffre du même défaut de câblage, et ce lot ne le
  // corrige PAS (périmètre explicite — un endpoint machine Bearer n'a pas le modèle de sécurité
  // d'un retour OAuth utilisateur). Ce test échouera le jour où ce sera traité, et c'est voulu :
  // il force à le faire sciemment, dans le lot prévu pour cela.
  it("/api/retention/dry-run reste refusé par le Proxy — hors périmètre de ce lot", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/api/retention/dry-run"));

    expect(reponse.status).toBe(401);
  });

  // PILOT_PRODUCTION_HARDENING_V1 — la sonde doit atteindre son handler SANS session : une sonde
  // externe, ou le healthcheck natif de la plateforme, n'envoie ni cookie ni en-tête. Un 401 ici
  // rendrait la supervision impossible, et pire : un moniteur recevant systématiquement 401
  // signalerait une panne permanente, donc serait débranché, donc ne signalerait plus rien.
  it("/api/health atteint son handler sans session — ni 401, ni redirection", async () => {
    getIronSessionMock.mockResolvedValue({});
    const { proxy } = await import("./proxy");
    const reponse = await proxy(requete("/api/health"));

    expect(reponse.status).not.toBe(401);
    expect(reponse.status).not.toBe(307);
    expect(reponse.headers.get("location")).toBeNull();
    // Jamais consultée : le Proxy sort avant toute lecture de session pour ce chemin.
    expect(getIronSessionMock).not.toHaveBeenCalled();
  });

  // Le pendant du test ci-dessus : ouvrir /api/health n'ouvre QUE /api/health. Un préfixe laissé
  // large aurait rendu publique toute route commençant par le même segment.
  it.each(["/api/health/detail", "/api/healthz", "/api/health-check"])(
    "%s reste privé : l'exception de santé est une égalité exacte, jamais un préfixe",
    async (chemin) => {
      getIronSessionMock.mockResolvedValue({});
      const { proxy } = await import("./proxy");
      const reponse = await proxy(requete(chemin));

      expect(reponse.status).toBe(401);
    }
  );

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

  // FIX_GOOGLE_OAUTH_CALLBACK_PROXY_V1 — le callback est laissé passer PAR LA LOGIQUE du Proxy, pas
  // en l'excluant du matcher. La distinction compte : une exclusion de matcher le rendrait
  // invisible au Proxy pour toujours, y compris pour une garde future, alors qu'une entrée dans un
  // ensemble nommé reste lisible et révocable à un seul endroit.
  it("/api/auth/google/callback reste couvert par le matcher (laissé passer par la logique, non par exclusion)", async () => {
    expect(await matcherDeclenchePourLeProxy("/api/auth/google/callback")).toBe(true);
  });
});
