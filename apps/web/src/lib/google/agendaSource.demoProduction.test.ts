import { afterEach, describe, expect, it, vi } from "vitest";

// Même principe et même patron que bienRepository.demoProduction.test.ts : en production, le repli
// mock (data/agenda.ts) ne doit JAMAIS atteindre l'écran. Un conseiller réel sans Google Calendar
// connecté voyait trois rendez-vous inventés (Oberkampf, Vincennes, Batignolles) dans son cockpit —
// des noms et des adresses qui ne sont pas les siens. Hors production (dev/tests), le repli reste
// utile et inchangé.
//
// Les dépendances Google sont mockées : aucun OAuth réel, aucun appel réseau. Le seul point testé
// est le branchement sur NODE_ENV, indépendant du contenu de l'agenda.
vi.mock("./connexion", () => ({ lireConnexionGoogle: vi.fn() }));
vi.mock("./oauth", () => ({
  rafraichirAccessToken: vi.fn(),
  SCOPE_CALENDAR_READONLY: "https://www.googleapis.com/auth/calendar.events.readonly",
  SCOPE_GMAIL_SEND: "https://www.googleapis.com/auth/gmail.send",
}));
vi.mock("./calendarClient", () => ({ listerEvenements: vi.fn() }));

const { lireConnexionGoogle } = await import("./connexion");
const { rafraichirAccessToken } = await import("./oauth");
const { getAgendaSemaine } = await import("./agendaSource");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(lireConnexionGoogle).mockReset();
  vi.mocked(rafraichirAccessToken).mockReset();
});

describe("getAgendaSemaine — isolation démo/production", () => {
  it("production + aucune connexion Google : agenda vide, jamais les rendez-vous mockés", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(lireConnexionGoogle).mockResolvedValue(undefined);

    const { rendezVous, source } = await getAgendaSemaine();

    expect(rendezVous).toEqual([]);
    // La source reste "demo" : c'est elle qui porte le badge expliquant pourquoi l'agenda n'est pas
    // celui de Google, et ce badge doit rester affiché même avec une liste vide.
    expect(source).toBe("demo");
  });

  it("hors production + aucune connexion Google : repli mock historique conservé", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(lireConnexionGoogle).mockResolvedValue(undefined);

    const { rendezVous, source } = await getAgendaSemaine();

    expect(rendezVous.length).toBeGreaterThan(0);
    expect(source).toBe("demo");
  });

  it("production + erreur Google : agenda vide, jamais les rendez-vous mockés", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(lireConnexionGoogle).mockResolvedValue({ refreshToken: "factice", scope: "" });
    vi.mocked(rafraichirAccessToken).mockRejectedValue(new Error("token révoqué (simulé)"));

    const { rendezVous, source } = await getAgendaSemaine();

    expect(rendezVous).toEqual([]);
    expect(source).toBe("demo_erreur");
  });

  it("production + base de données injoignable : agenda vide, jamais une erreur remontée à l'écran", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(lireConnexionGoogle).mockRejectedValue(new Error("connexion refusée (simulé)"));

    const { rendezVous, source } = await getAgendaSemaine();

    expect(rendezVous).toEqual([]);
    expect(source).toBe("demo");
  });

  it("hors production + erreur Google : repli mock historique conservé", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(lireConnexionGoogle).mockResolvedValue({ refreshToken: "factice", scope: "" });
    vi.mocked(rafraichirAccessToken).mockRejectedValue(new Error("token révoqué (simulé)"));

    const { rendezVous, source } = await getAgendaSemaine();

    expect(rendezVous.length).toBeGreaterThan(0);
    expect(source).toBe("demo_erreur");
  });
});
