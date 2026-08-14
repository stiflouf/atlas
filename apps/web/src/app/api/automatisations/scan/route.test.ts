import { describe, expect, it } from "vitest";

// Test d'intégration réel (ADR-033) : le secret est fixé AVANT l'import de la route, comme
// DATABASE_URL dans les autres suites — la route lit process.env au moment de l'appel, pas à
// l'import, mais fixer tôt évite toute ambiguïté d'ordre.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";
process.env.AUTOMATISATIONS_SCAN_SECRET = "secret-de-test-tres-long-et-suffisant";

const { POST } = await import("./route");

function requete(autorisation?: string): Request {
  const headers = new Headers();
  if (autorisation !== undefined) headers.set("authorization", autorisation);
  return new Request("http://localhost/api/automatisations/scan", { method: "POST", headers });
}

describe("POST /api/automatisations/scan", () => {
  it("401 si l'en-tête Authorization est absent", async () => {
    const reponse = await POST(requete());
    expect(reponse.status).toBe(401);
  });

  it("401 si le secret est incorrect", async () => {
    const reponse = await POST(requete("Bearer mauvais-secret"));
    expect(reponse.status).toBe(401);
  });

  it("401 si le schéma n'est pas Bearer", async () => {
    const reponse = await POST(requete("Basic secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(401);
  });

  it("200 avec le secret correct (règle inactive par défaut : aucun scan réellement effectué)", async () => {
    const reponse = await POST(requete("Bearer secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps).toEqual({ execute: false });
  });
});
