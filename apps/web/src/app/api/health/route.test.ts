import { beforeEach, describe, expect, it, vi } from "vitest";

// PILOT_PRODUCTION_HARDENING_V1 — tests de la ROUTE de santé : traduction d'un verdict en réponse
// HTTP, et rien de plus. Les vérifications elles-mêmes (base, stockage) vivent dans
// `src/lib/sante/dependancesSante.ts` et sont testées à part — c'est la séparation imposée par
// ADR-007 (seuls les modules de `src/lib` parlent à Postgres), pas un découpage de confort.

const verifierDependances = vi.fn();
vi.mock("@/lib/sante/dependancesSante", () => ({
  verifierDependancesSante: () => verifierDependances(),
}));

const { GET } = await import("./route");

beforeEach(() => {
  verifierDependances.mockReset().mockResolvedValue({ database: "UP", documentStorage: "UP" });
});

describe("GET /api/health — verdict HTTP", () => {
  it("répond 200 et UP/UP quand les deux dépendances répondent", async () => {
    const reponse = await GET();
    expect(reponse.status).toBe(200);
    await expect(reponse.json()).resolves.toEqual({
      application: "UP",
      database: "UP",
      documentStorage: "UP",
    });
  });

  it("répond 503 si la base est DOWN", async () => {
    verifierDependances.mockResolvedValue({ database: "DOWN", documentStorage: "UP" });
    const reponse = await GET();
    expect(reponse.status).toBe(503);
    await expect(reponse.json()).resolves.toMatchObject({ database: "DOWN", documentStorage: "UP" });
  });

  it("répond 503 si le stockage documentaire est DOWN (volume détaché)", async () => {
    verifierDependances.mockResolvedValue({ database: "UP", documentStorage: "DOWN" });
    const reponse = await GET();
    expect(reponse.status).toBe(503);
    await expect(reponse.json()).resolves.toMatchObject({ database: "UP", documentStorage: "DOWN" });
  });

  it("une seule dépendance DOWN suffit : jamais de 200 partiel", async () => {
    for (const verdict of [
      { database: "DOWN", documentStorage: "UP" },
      { database: "UP", documentStorage: "DOWN" },
      { database: "DOWN", documentStorage: "DOWN" },
    ]) {
      verifierDependances.mockResolvedValue(verdict);
      expect((await GET()).status, JSON.stringify(verdict)).toBe(503);
    }
  });

  it("`application` vaut toujours UP : si ce corps est rendu, le processus répond", async () => {
    verifierDependances.mockResolvedValue({ database: "DOWN", documentStorage: "DOWN" });
    const corps = await (await GET()).json();
    expect(corps.application).toBe("UP");
  });
});

describe("GET /api/health — ne divulgue rien", () => {
  it("ne renvoie que les trois états attendus, jamais un champ supplémentaire", async () => {
    // Même si la couche de vérification renvoyait un jour un détail en plus, la route ne le
    // recopierait pas : elle reconstruit son corps champ par champ.
    verifierDependances.mockResolvedValue({
      database: "UP",
      documentStorage: "UP",
      chemin: "/data/stockage-documents",
      hote: "postgres.railway.internal",
    });

    const corps = await (await GET()).json();

    expect(Object.keys(corps).sort()).toEqual(["application", "database", "documentStorage"]);
    const brut = JSON.stringify(corps);
    expect(brut).not.toContain("/data/stockage-documents");
    expect(brut).not.toContain("railway.internal");
  });

  it("interdit la mise en cache de la réponse, dans les deux verdicts", async () => {
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
    verifierDependances.mockResolvedValue({ database: "DOWN", documentStorage: "UP" });
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });
});
