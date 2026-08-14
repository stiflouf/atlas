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
