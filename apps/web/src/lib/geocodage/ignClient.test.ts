import { afterEach, describe, expect, it, vi } from "vitest";
import { CODES_INSEE_VILLE_A_ARRONDISSEMENTS, geocoderAdresse, rechercherCommunes, verifierCommune } from "./ignClient";

// Réponses construites à partir de vérifications empiriques réelles contre l'API IGN Géoplateforme
// (ADR-035, audit) — ne pas dépendre du réseau réel dans la suite automatisée principale (une
// validation réelle séparée a été faite manuellement, voir docs/adr/035-...).
afterEach(() => {
  vi.unstubAllGlobals();
});

function reponseIgn(features: unknown[]): Response {
  return new Response(JSON.stringify({ features, query: "test" }), { status: 200 });
}

function featureHouilles() {
  return {
    geometry: { coordinates: [2.186545, 48.926572] },
    properties: {
      score: 0.9515,
      label: "Houilles",
      citycode: "78311",
      city: "Houilles",
      postcode: "78800",
      context: "78, Yvelines, Île-de-France",
      type: "municipality",
    },
  };
}

function featureParisGenerique() {
  return {
    geometry: { coordinates: [2.347, 48.859] },
    properties: {
      score: 0.9703,
      label: "Paris",
      citycode: "75056",
      city: "Paris",
      postcode: "75001",
      context: "75, Paris, Île-de-France",
      type: "municipality",
    },
  };
}

function featureParis15e() {
  return {
    geometry: { coordinates: [2.295289, 48.84162] },
    properties: {
      score: 0.8693,
      label: "Paris 15e Arrondissement",
      citycode: "75115",
      city: "Paris 15e Arrondissement",
      postcode: "75015",
      context: "75, Paris, Île-de-France",
      type: "municipality",
    },
  };
}

describe("geocoderAdresse — parsing étendu (ADR-035)", () => {
  it("expose commune {citycode, nom, codePostal, contexte} en plus de coordonnees/score/labelTrouve", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn([featureHouilles()])));
    const resultat = await geocoderAdresse("1 rue Test, 78800 Houilles");
    expect(resultat).toBeDefined();
    expect(resultat?.commune).toEqual({
      citycode: "78311",
      nom: "Houilles",
      codePostal: "78800",
      contexte: "78, Yvelines, Île-de-France",
    });
    expect(resultat?.score).toBeCloseTo(0.9515);
  });

  it("commune est undefined si la réponse ne porte pas citycode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reponseIgn([{ geometry: { coordinates: [1, 1] }, properties: { score: 0.5, label: "Inconnu" } }])
      )
    );
    const resultat = await geocoderAdresse("adresse quelconque");
    expect(resultat?.commune).toBeUndefined();
  });

  it("undefined si aucun résultat (comportement existant préservé)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn([])));
    await expect(geocoderAdresse("nawak")).resolves.toBeUndefined();
  });

  it("undefined en cas d'erreur HTTP (comportement existant préservé)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erreur", { status: 500 })));
    await expect(geocoderAdresse("adresse")).resolves.toBeUndefined();
  });

  it("undefined en cas de rupture réseau (comportement existant préservé)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(geocoderAdresse("adresse")).resolves.toBeUndefined();
  });
});

describe("rechercherCommunes", () => {
  it("retourne les communes trouvées avec citycode/nom/codePostal/contexte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn([featureHouilles()])));
    const communes = await rechercherCommunes("Houilles");
    expect(communes).toEqual([
      { citycode: "78311", nom: "Houilles", codePostal: "78800", contexte: "78, Yvelines, Île-de-France" },
    ]);
  });

  it("exclut systématiquement l'entrée générique Paris (75056), jamais traitée comme équivalente à tous les arrondissements", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn([featureParisGenerique(), featureParis15e()])));
    const communes = await rechercherCommunes("Paris");
    expect(communes.map((c) => c.citycode)).toEqual(["75115"]);
    expect(communes.some((c) => c.citycode === "75056")).toBe(false);
  });

  it("exclut les trois codes génériques Paris/Lyon/Marseille par construction", () => {
    expect(CODES_INSEE_VILLE_A_ARRONDISSEMENTS.has("75056")).toBe(true);
    expect(CODES_INSEE_VILLE_A_ARRONDISSEMENTS.has("69123")).toBe(true);
    expect(CODES_INSEE_VILLE_A_ARRONDISSEMENTS.has("13055")).toBe(true);
    expect(CODES_INSEE_VILLE_A_ARRONDISSEMENTS.has("78311")).toBe(false);
  });

  it("retourne un tableau vide pour une recherche vide, sans appel réseau (le seuil UX de 2 caractères vit dans la route API, pas ici)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(rechercherCommunes("   ")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retourne un tableau vide en cas d'erreur HTTP/réseau, jamais une exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erreur", { status: 500 })));
    await expect(rechercherCommunes("Houilles")).resolves.toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(rechercherCommunes("Houilles")).resolves.toEqual([]);
  });
});

describe("verifierCommune — re-vérification serveur (ADR-035, section 8)", () => {
  it("retourne la commune fraîchement vérifiée si l'IGN confirme le citycode", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn([featureHouilles()])));
    const commune = await verifierCommune("78311", "Houilles");
    expect(commune).toEqual({
      citycode: "78311",
      nom: "Houilles",
      codePostal: "78800",
      contexte: "78, Yvelines, Île-de-France",
    });
  });

  it("undefined si l'IGN ne retourne aucun résultat", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reponseIgn([])));
    await expect(verifierCommune("78311", "Houilles")).resolves.toBeUndefined();
  });

  it("undefined si le citycode retourné par l'IGN ne correspond pas exactement à celui soumis — jamais une confiance aveugle dans la soumission client", async () => {
    // Le client prétend "78311" mais l'IGN, interrogé fraîchement, ne confirme qu'un citycode
    // différent (ex. donnée manipulée ou périmée côté client).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reponseIgn([{ ...featureHouilles(), properties: { ...featureHouilles().properties, citycode: "99999" } }])
      )
    );
    await expect(verifierCommune("78311", "Houilles")).resolves.toBeUndefined();
  });

  it("undefined en cas d'erreur réseau/HTTP — jamais une acceptation par défaut", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erreur", { status: 503 })));
    await expect(verifierCommune("78311", "Houilles")).resolves.toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    await expect(verifierCommune("78311", "Houilles")).resolves.toBeUndefined();
  });
});
