import { afterEach, describe, expect, it, vi } from "vitest";
import { resoudreCommuneBien } from "./resolutionBien";

afterEach(() => {
  vi.unstubAllGlobals();
});

function reponseIgn(score: number, avecCitycode = true): Response {
  const properties: Record<string, unknown> = { score, label: "Houilles" };
  if (avecCitycode) {
    Object.assign(properties, { citycode: "78311", city: "Houilles", postcode: "78800", context: "78, Yvelines" });
  }
  return new Response(
    JSON.stringify({ features: [{ geometry: { coordinates: [2.18, 48.92] }, properties }] }),
    { status: 200 }
  );
}

describe("resoudreCommuneBien — résolution non bloquante (ADR-035, section 5)", () => {
  it("retourne la commune si le score est fiable (>= 0.8, SEUIL_FIABLE)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.95)));
    const commune = await resoudreCommuneBien("1 rue Test", "Houilles", "78800");
    expect(commune).toEqual({ citycode: "78311", nom: "Houilles", codePostal: "78800", contexte: "78, Yvelines" });
  });

  it("retourne undefined si le score est insuffisant, même avec un citycode présent — jamais une valeur approximative", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.6)));
    await expect(resoudreCommuneBien("1 rue Test", "Houilles", "78800")).resolves.toBeUndefined();
  });

  it("retourne undefined si le score est exactement au seuil a_verifier (0.5), toujours insuffisant pour un bien", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.5)));
    await expect(resoudreCommuneBien("1 rue Test", "Houilles", "78800")).resolves.toBeUndefined();
  });

  it("retourne undefined si le score est fiable mais la réponse ne porte pas de citycode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn(0.95, false)));
    await expect(resoudreCommuneBien("1 rue Test", "Houilles", "78800")).resolves.toBeUndefined();
  });

  it("retourne undefined si l'IGN ne retourne aucun résultat (adresse non reconnue)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 })));
    await expect(resoudreCommuneBien("adresse inconnue", "Nulle part", "00000")).resolves.toBeUndefined();
  });

  it("retourne undefined en cas d'échec réseau — jamais bloquant pour l'enregistrement du bien", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(resoudreCommuneBien("1 rue Test", "Houilles", "78800")).resolves.toBeUndefined();
  });

  it("retourne undefined en cas d'erreur HTTP (5xx/4xx)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erreur", { status: 500 })));
    await expect(resoudreCommuneBien("1 rue Test", "Houilles", "78800")).resolves.toBeUndefined();
  });
});
