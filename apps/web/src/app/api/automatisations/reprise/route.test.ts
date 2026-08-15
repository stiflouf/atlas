import { describe, expect, it } from "vitest";

// Test d'intégration réel (ADR-038) — même patron d'authentification que
// src/app/api/automatisations/scan/route.test.ts (ADR-033).
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";
process.env.AUTOMATISATIONS_REPRISE_SECRET = "secret-reprise-de-test-tres-long-et-suffisant";

const { POST } = await import("./route");

function requete(autorisation?: string): Request {
  const headers = new Headers();
  if (autorisation !== undefined) headers.set("authorization", autorisation);
  return new Request("http://localhost/api/automatisations/reprise", { method: "POST", headers });
}

describe("POST /api/automatisations/reprise — authentification", () => {
  it("401 si l'en-tête Authorization est absent", async () => {
    expect((await POST(requete())).status).toBe(401);
  });

  it("401 si le secret est incorrect", async () => {
    expect((await POST(requete("Bearer mauvais-secret"))).status).toBe(401);
  });

  it("401 si le schéma n'est pas Bearer", async () => {
    expect((await POST(requete("Basic secret-reprise-de-test-tres-long-et-suffisant"))).status).toBe(401);
  });

  it("le secret du scan temporel (AUTOMATISATIONS_SCAN_SECRET) ne doit jamais suffire ici — endpoints distincts", async () => {
    const reponse = await POST(requete("Bearer secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(401);
  });

  it("200 avec le secret correct", async () => {
    const reponse = await POST(requete("Bearer secret-reprise-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps).toHaveProperty("examinees");
    expect(corps).toHaveProperty("traitees");
    expect(corps).toHaveProperty("plafondAtteint");
  });
});
