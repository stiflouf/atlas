import { afterEach, describe, expect, it, vi } from "vitest";
import { envoyerMessageGmail } from "./gmailClient";

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("envoyerMessageGmail", () => {
  it("succès : réponse 200 avec un id valide -> type 'succes'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "msg-123" }), { status: 200 }))
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");
    expect(resultat).toEqual({ type: "succes", gmailMessageId: "msg-123" });
  });

  it("échec CONNU : réponse HTTP non-2xx effectivement reçue -> type 'echec', jamais incertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 }))
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");
    expect(resultat.type).toBe("echec");
    expect((resultat as { erreurTechnique: string }).erreurTechnique).toContain("authentification_google_invalide");
  });

  it("échec CONNU générique (5xx) -> type 'echec'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erreur serveur", { status: 500 }))
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");
    expect(resultat.type).toBe("echec");
    expect((resultat as { erreurTechnique: string }).erreurTechnique).toContain("erreur_google");
  });

  it("rupture réseau avant toute réponse HTTP -> type 'incertain', jamais 'echec'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");
    expect(resultat.type).toBe("incertain");
    expect((resultat as { erreurTechnique: string }).erreurTechnique).toBe("reseau_ou_timeout");
  });

  it("réponse 2xx mais corps illisible -> type 'incertain', jamais un succès supposé", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("pas du json", { status: 200 }))
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");
    expect(resultat.type).toBe("incertain");
    expect((resultat as { erreurTechnique: string }).erreurTechnique).toBe("reponse_illisible");
  });

  it("réponse 2xx sans identifiant de message valide -> type 'incertain'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");
    expect(resultat.type).toBe("incertain");
    expect((resultat as { erreurTechnique: string }).erreurTechnique).toBe("reponse_sans_identifiant");
  });

  it("destinataire invalide -> échec avant tout appel réseau", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultat = await envoyerMessageGmail("token", "pas-un-email", "Objet", "Corps");
    expect(resultat.type).toBe("echec");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Bugfix pilote (envoi Gmail en échec sans aucune trace Railway) : un échec HTTP non-2xx ne
// journalisait rien et ne lisait même pas le corps de la réponse Google — impossible de
// distinguer scope manquant / API désactivée / quota / payload rejeté depuis les logs seuls.
describe("envoyerMessageGmail — diagnostic sécurisé (bugfix pilote)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("403 accessNotConfigured (Gmail API non activée) : journalise status/code/reason, jamais le token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 403,
                status: "PERMISSION_DENIED",
                errors: [{ reason: "accessNotConfigured", message: "Gmail API has not been used in project ... before" }],
              },
            }),
            { status: 403 }
          )
      )
    );
    const secretToken = "ya29.secret-access-token-ne-doit-jamais-apparaitre";
    const resultat = await envoyerMessageGmail(secretToken, "jean@test.local", "Objet", "Corps");

    expect(resultat.type).toBe("echec");
    expect(spy).toHaveBeenCalledTimes(1);
    const logLigne = spy.mock.calls[0].join(" ");
    expect(logLigne).toContain("status=403");
    expect(logLigne).toContain("reason=accessNotConfigured");
    expect(logLigne).not.toContain(secretToken);
    spy.mockRestore();
  });

  it("400 (payload rejeté par Google) : journalise status=400, jamais de secret", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT" } }), { status: 400 }))
    );
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");

    expect(resultat.type).toBe("echec");
    const logLigne = spy.mock.calls[0].join(" ");
    expect(logLigne).toContain("status=400");
    expect(logLigne).toContain("code=INVALID_ARGUMENT");
    spy.mockRestore();
  });

  it("401 (token invalide) : journalise status=401, jamais l'en-tête Authorization ni le token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 })));
    const secretToken = "ya29.autre-secret-access-token";
    await envoyerMessageGmail(secretToken, "jean@test.local", "Objet", "Corps");

    const logLigne = spy.mock.calls[0].join(" ");
    expect(logLigne).toContain("status=401");
    expect(logLigne).not.toContain(secretToken);
    expect(logLigne).not.toContain("Authorization");
    expect(logLigne).not.toContain("Bearer");
    spy.mockRestore();
  });

  it("corps d'erreur illisible : aucune exception, log au statut seul", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("pas du json", { status: 500 })));
    const resultat = await envoyerMessageGmail("token", "jean@test.local", "Objet", "Corps");

    expect(resultat.type).toBe("echec");
    expect(spy.mock.calls[0].join(" ")).toContain("status=500");
    spy.mockRestore();
  });
});
