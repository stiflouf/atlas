import { afterEach, describe, expect, it, vi } from "vitest";

// ADR-047 : cette route exige désormais une session Atlas. Le comportement métier (proxy IGN) est
// testé ici en mockant exigerSessionAtlas() comme une session valide — le refus anonyme réel est
// couvert séparément par route.securite.test.ts, qui utilise le vrai helper (jamais mocké là-bas).
vi.mock("@/lib/auth/sessionAtlas", () => ({
  exigerSessionAtlas: vi.fn().mockResolvedValue({ sub: "test-sub", email: "conseiller@example.com" }),
}));

const { GET } = await import("./route");

afterEach(() => {
  vi.unstubAllGlobals();
});

function requete(q: string): Request {
  return new Request(`http://localhost/api/geocodage/communes?q=${encodeURIComponent(q)}`);
}

describe("GET /api/geocodage/communes", () => {
  it("retourne un tableau vide sans appel réseau pour une recherche de moins de 2 caractères", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const reponse = await GET(requete("H"));
    const body = await reponse.json();

    expect(body).toEqual({ communes: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxifie la recherche IGN et retourne les communes structurées", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: [2.18, 48.92] },
                properties: {
                  score: 0.95,
                  label: "Houilles",
                  citycode: "78311",
                  city: "Houilles",
                  postcode: "78800",
                  context: "78, Yvelines, Île-de-France",
                  type: "municipality",
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const reponse = await GET(requete("Houilles"));
    const body = await reponse.json();

    expect(body).toEqual({
      communes: [{ citycode: "78311", nom: "Houilles", codePostal: "78800", contexte: "78, Yvelines, Île-de-France" }],
    });
  });
});
