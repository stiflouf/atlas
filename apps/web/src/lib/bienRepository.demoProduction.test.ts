import { afterEach, describe, expect, it, vi } from "vitest";

// Bugfix pilote (contamination Postgres SQLSTATE 22P02 avec un id de démonstration "client-001") :
// en production, une base réelle vide ou en panne ne doit JAMAIS se traduire par un repli sur
// data/biens.ts — seulement un vrai état vide (DB vide) ou une erreur explicite (DB en panne),
// jamais mélangés. Hors production (dev/tests), le comportement historique reste inchangé — voir
// bienRepository.test.ts (intégration Postgres réelle, toujours hors production ici).
//
// getDb() est mocké (chaîne Drizzle factice thenable) plutôt que la vraie base : le seul point
// testé ici est le branchement sur NODE_ENV, indépendant du contenu réel des lignes retournées.
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
const { listerBiens, getBienById } = await import("./bienRepository");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getDb).mockReset();
});

describe("bienRepository — isolation démo/production (bugfix pilote)", () => {
  it("production + DB vide (aucune erreur) : listerBiens() rend un tableau vide, jamais les mocks", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getDb).mockReturnValue(chaineFactice([]) as never);

    const resultat = await listerBiens();
    expect(resultat).toEqual([]);
  });

  it("développement/test + DB vide : listerBiens() garde le repli mock historique", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(getDb).mockReturnValue(chaineFactice([]) as never);

    const resultat = await listerBiens();
    expect(resultat.some((b) => b.id === "bien-001")).toBe(true);
  });

  it("production + erreur Postgres : listerBiens() propage l'erreur, jamais de données fictives", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    await expect(listerBiens()).rejects.toThrow(panne);
  });

  it("développement/test + erreur Postgres : listerBiens() garde le repli mock historique", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    const resultat = await listerBiens();
    expect(resultat.some((b) => b.id === "bien-001")).toBe(true);
  });

  it("production + DB vide : getBienById(\"bien-001\") ne résout jamais le bien de démonstration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(getDb).mockReturnValue(chaineFactice([{ total: 0 }]) as never);

    await expect(getBienById("bien-001")).resolves.toBeUndefined();
  });

  it("développement/test + DB vide : getBienById(\"bien-001\") résout toujours le bien de démonstration", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.mocked(getDb).mockReturnValue(chaineFactice([{ total: 0 }]) as never);

    const resultat = await getBienById("bien-001");
    expect(resultat?.id).toBe("bien-001");
  });

  it("production + erreur Postgres : getBienById() propage l'erreur, jamais un id de démonstration résolu", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const panne = new Error("connexion refusée (simulé)");
    vi.mocked(getDb).mockReturnValue(chaineFactice([], panne) as never);

    await expect(getBienById("bien-001")).rejects.toThrow(panne);
  });
});
