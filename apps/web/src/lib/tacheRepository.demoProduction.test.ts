import { afterEach, describe, expect, it, vi } from "vitest";

// Bugfix pilote : en production, une base réelle vide ou en panne ne doit JAMAIS se traduire par
// un repli sur data/taches.ts (id "tache-001" etc.) — seulement un vrai état vide (DB vide) ou une
// erreur explicite (DB en panne), jamais mélangés. Hors production (dev/tests), comportement
// historique inchangé. Même principe et même mock que bienRepository.demoProduction.test.ts.
function chaineFactice(resultat: unknown[], erreur?: Error) {
  const chaine: Record<string, unknown> = {
    select: () => chaine,
    from: () => chaine,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      erreur ? Promise.reject(erreur).then(resolve, reject) : Promise.resolve(resultat).then(resolve, reject),
  };
  return chaine;
}

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/db/client");
const { listerTaches } = await import("./tacheRepository");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getDb).mockReset();
});

describe("tacheRepository — isolation démo/production (bugfix pilote)", () => {
  it("production + DB vide (aucune erreur) : listerTaches() rend un tableau vide — le cockpit \"Aujourd'hui\" affiche un vrai zéro", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getDb).mockReturnValue(chaineFactice([]) as never);

    const resultat = await listerTaches();
    expect(resultat).toEqual([]);
  });

  it("développement/test + DB vide : listerTaches() garde le repli mock historique", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(getDb).mockReturnValue(chaineFactice([]) as never);

    const resultat = await listerTaches();
    expect(resultat.some((t) => t.id === "tache-001")).toBe(true);
  });

  it("production + erreur Postgres : listerTaches() propage l'erreur, jamais de données fictives", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    await expect(listerTaches()).rejects.toThrow(panne);
  });

  it("développement/test + erreur Postgres : listerTaches() garde le repli mock historique", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    const resultat = await listerTaches();
    expect(resultat.some((t) => t.id === "tache-001")).toBe(true);
  });
});
