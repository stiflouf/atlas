import { afterEach, describe, expect, it, vi } from "vitest";

// Bugfix pilote (contamination Postgres SQLSTATE 22P02 avec l'id de démonstration "client-001") :
// en production, une base réelle vide ou en panne ne doit JAMAIS se traduire par un repli sur
// data/clients.ts — seulement un vrai état vide (DB vide) ou une erreur explicite (DB en panne),
// jamais mélangés. Hors production (dev/tests), comportement historique inchangé — voir
// clientRepository.test.ts (intégration Postgres réelle, toujours hors production ici). Même
// principe et même mock que bienRepository.demoProduction.test.ts.
function chaineFactice(resultat: unknown[], erreur?: Error) {
  const chaine: Record<string, unknown> = {
    select: () => chaine,
    from: () => chaine,
    where: () => chaine,
    limit: () => chaine,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      erreur ? Promise.reject(erreur).then(resolve, reject) : Promise.resolve(resultat).then(resolve, reject),
  };
  return chaine;
}

vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/db/client");
const { listerClients, getClientById } = await import("./clientRepository");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getDb).mockReset();
});

describe("clientRepository — isolation démo/production (bugfix pilote)", () => {
  it("production + DB vide (aucune erreur) : listerClients() rend un tableau vide, jamais les mocks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getDb).mockReturnValue(chaineFactice([]) as never);

    const resultat = await listerClients();
    expect(resultat).toEqual([]);
  });

  it("développement/test + DB vide : listerClients() garde le repli mock historique", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(getDb).mockReturnValue(chaineFactice([]) as never);

    const resultat = await listerClients();
    expect(resultat.some((c) => c.id === "client-001")).toBe(true);
  });

  it("production + erreur Postgres : listerClients() propage l'erreur, jamais de données fictives", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    await expect(listerClients()).rejects.toThrow(panne);
  });

  it("développement/test + erreur Postgres : listerClients() garde le repli mock historique", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    const resultat = await listerClients();
    expect(resultat.some((c) => c.id === "client-001")).toBe(true);
  });

  it("production + DB vide : getClientById(\"client-001\") ne résout jamais le client de démonstration (la faille SQLSTATE 22P02 constatée)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getDb).mockReturnValue(chaineFactice([{ total: 0 }]) as never);

    await expect(getClientById("client-001")).resolves.toBeUndefined();
  });

  it("développement/test + DB vide : getClientById(\"client-001\") résout toujours le client de démonstration", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(getDb).mockReturnValue(chaineFactice([{ total: 0 }]) as never);

    const resultat = await getClientById("client-001");
    expect(resultat?.id).toBe("client-001");
  });

  it("production + erreur Postgres : getClientById() propage l'erreur, jamais un id de démonstration résolu", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    await expect(getClientById("client-001")).rejects.toThrow(panne);
  });
});
