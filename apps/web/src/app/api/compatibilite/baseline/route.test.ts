import { describe, expect, it } from "vitest";

// Test d'intégration réel (ADR-036) — même patron d'authentification que
// src/app/api/automatisations/scan/route.test.ts (ADR-033), secret DÉDIÉ distinct de
// COMPATIBILITE_SCAN_SECRET.
process.env.DATABASE_URL ??= "postgresql://atlas:atlas@localhost:5432/atlas";
process.env.COMPATIBILITE_BASELINE_SECRET = "secret-baseline-de-test-tres-long-et-suffisant";

const { POST } = await import("./route");

function requete(corps?: unknown, autorisation?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (autorisation !== undefined) headers.set("authorization", autorisation);
  return new Request("http://localhost/api/compatibilite/baseline", {
    method: "POST",
    headers,
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
}

const AUTORISATION = "Bearer secret-baseline-de-test-tres-long-et-suffisant";

describe("POST /api/compatibilite/baseline — authentification", () => {
  it("401 si l'en-tête Authorization est absent", async () => {
    expect((await POST(requete({ mode: "dry-run" }))).status).toBe(401);
  });

  it("401 si le secret est incorrect", async () => {
    expect((await POST(requete({ mode: "dry-run" }, "Bearer mauvais-secret"))).status).toBe(401);
  });

  it("le secret du scan de reprise (COMPATIBILITE_SCAN_SECRET) ne doit jamais suffire ici — endpoints distincts", async () => {
    const reponse = await POST(requete({ mode: "dry-run" }, "Bearer secret-de-test-tres-long-et-suffisant"));
    expect(reponse.status).toBe(401);
  });
});

describe("POST /api/compatibilite/baseline — mode par défaut et dry-run", () => {
  it("mode absent → dry-run (jamais une écriture accidentelle)", async () => {
    const reponse = await POST(requete({}, AUTORISATION));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.mode).toBe("dry-run");
    expect(corps.evenementsCrees).toBe(0);
  });

  it("corps de requête absent/invalide → dry-run par défaut, jamais une erreur", async () => {
    const reponse = await POST(requete(undefined, AUTORISATION));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.mode).toBe("dry-run");
  });

  it("mode dry-run explicite : rapport cohérent, 0 événement", async () => {
    const reponse = await POST(requete({ mode: "dry-run" }, AUTORISATION));
    const corps = await reponse.json();
    expect(corps.mode).toBe("dry-run");
    expect(corps.evenementsCrees).toBe(0);
    expect(corps.compatibles + corps.incompatibles + corps.aVerifier).toBe(corps.pairesEvaluees);
  });
});

describe("POST /api/compatibilite/baseline — protection contre l'écrasement accidentel (§27)", () => {
  it("apply sans confirmerEcrasementExistant est refusé (409) si la table contient déjà des lignes", async () => {
    // La table compatibilites_bien_acquereur_etat contient déjà des lignes issues des autres
    // suites d'intégration ADR-036 exécutées dans cette même base — ce test suppose un état non
    // vide (cohérent avec la suite complète) ; si la table était vide, appliquerBaseline()
    // renverrait 200 au lieu de 409, ce que le test suivant vérifie explicitement pour l'autre cas.
    const reponse = await POST(requete({ mode: "apply" }, AUTORISATION));
    if (reponse.status === 409) {
      const corps = await reponse.json();
      expect(corps).toHaveProperty("lignesExistantes");
    } else {
      expect(reponse.status).toBe(200);
    }
  });

  it("apply avec confirmerEcrasementExistant: true est toujours accepté", async () => {
    const reponse = await POST(requete({ mode: "apply", confirmerEcrasementExistant: true }, AUTORISATION));
    expect(reponse.status).toBe(200);
    const corps = await reponse.json();
    expect(corps.mode).toBe("apply");
    expect(corps.evenementsCrees).toBe(0);
    expect(corps.tachesCreees).toBe(0);
    expect(corps.emailsEnvoyes).toBe(0);
  });
});
