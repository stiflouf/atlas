import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PILOT_PRODUCTION_HARDENING_V1 — tests des VÉRIFICATIONS de santé.
//
// Les deux dépendances sont mockées : à ce niveau c'est le seul moyen d'observer le cas DOWN — une
// base réellement tombée ou un volume réellement détaché ne se provoquent pas dans une suite de
// tests. Les vérifications réelles sont exercées ailleurs :
// `src/lib/stockageDocuments.test.ts` pour `verifierDisponibiliteStockageDocuments` (répertoire
// absent, non-répertoire, droits), et l'aller-retour `select 1` contre le Postgres de test par
// toutes les suites d'intégration du dépôt.

const executeDb = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => ({ execute: executeDb }) }));

const verifierStockage = vi.fn();
vi.mock("@/lib/stockageDocuments", () => ({
  verifierDisponibiliteStockageDocuments: (...args: unknown[]) => verifierStockage(...args),
}));

const { verifierDatabase, verifierDependancesSante, verifierStockageDocuments } = await import("./dependancesSante");

beforeEach(() => {
  executeDb.mockReset().mockResolvedValue(undefined);
  verifierStockage.mockReset().mockResolvedValue("/tmp/stockage-de-test");
  // Les deux `catch` journalisent l'erreur réelle côté serveur : attendu, mais inutile dans la
  // sortie de test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifierDatabase", () => {
  it("UP quand l'aller-retour SQL aboutit", async () => {
    await expect(verifierDatabase()).resolves.toBe("UP");
  });

  it("DOWN quand la base est injoignable, sans propager l'exception", async () => {
    executeDb.mockRejectedValue(new Error("connect ECONNREFUSED postgres.railway.internal:5432"));
    await expect(verifierDatabase()).resolves.toBe("DOWN");
  });

  it("la vérification est minimale et non métier : un seul aller-retour, `select 1`", async () => {
    await verifierDatabase();
    expect(executeDb).toHaveBeenCalledTimes(1);
    // `sql` de Drizzle expose ses fragments bruts : on vérifie l'intention, pas la mise en forme.
    expect(JSON.stringify(executeDb.mock.calls[0][0])).toContain("select 1");
  });
});

describe("verifierStockageDocuments", () => {
  it("UP quand la racine est disponible", async () => {
    await expect(verifierStockageDocuments()).resolves.toBe("UP");
  });

  it("DOWN quand la racine est indisponible, sans propager l'exception", async () => {
    verifierStockage.mockRejectedValue(
      new Error("Répertoire de stockage documentaire introuvable : /data/stockage-documents")
    );
    await expect(verifierStockageDocuments()).resolves.toBe("DOWN");
  });

  it("exige l'ÉCRITURE — un volume seulement lisible n'est pas UP", async () => {
    // Un volume lisible mais non inscriptible laisserait échouer tout dépôt de document : une
    // sonde qui dirait UP dans ce cas mentirait.
    await verifierStockageDocuments();
    expect(verifierStockage).toHaveBeenCalledWith({ ecriture: true });
  });
});

describe("verifierDependancesSante", () => {
  it("agrège les deux verdicts", async () => {
    await expect(verifierDependancesSante()).resolves.toEqual({ database: "UP", documentStorage: "UP" });
  });

  it("une panne n'en masque jamais une autre : les deux dépendances sont toujours évaluées", async () => {
    executeDb.mockRejectedValue(new Error("base KO"));
    verifierStockage.mockRejectedValue(new Error("volume KO"));

    await expect(verifierDependancesSante()).resolves.toEqual({ database: "DOWN", documentStorage: "DOWN" });
    // Le vrai invariant : aucune sonde ne court-circuite l'autre. Réparer la base pour découvrir le
    // volume au redéploiement suivant est exactement ce que cette sonde doit éviter.
    expect(executeDb).toHaveBeenCalledTimes(1);
    expect(verifierStockage).toHaveBeenCalledTimes(1);
  });

  it("ne renvoie JAMAIS de message d'erreur : ni chemin de volume, ni hôte de base", async () => {
    executeDb.mockRejectedValue(new Error("connect ECONNREFUSED postgres.railway.internal:5432"));
    verifierStockage.mockRejectedValue(
      new Error("Répertoire de stockage documentaire introuvable : /data/stockage-documents")
    );

    const brut = JSON.stringify(await verifierDependancesSante());

    expect(brut).not.toContain("railway.internal");
    expect(brut).not.toContain("/data/stockage-documents");
    expect(brut).not.toContain("ECONNREFUSED");
    expect(brut).not.toMatch(/introuvable|Répertoire/);
  });

  it("journalise malgré tout l'erreur réelle côté serveur — le diagnostic n'est pas perdu", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    executeDb.mockRejectedValue(new Error("base KO"));

    await verifierDependancesSante();

    expect(journal).toHaveBeenCalledWith("[health] base de données indisponible :", expect.any(Error));
  });
});
