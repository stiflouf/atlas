import { afterEach, describe, expect, it, vi } from "vitest";

// Bugfix déploiement Railway — origineMetierPublique() doit dériver l'origine EXCLUSIVEMENT de
// GOOGLE_REDIRECT_URI, jamais d'une requête entrante (request.url/request.nextUrl), pour rester
// fiable derrière un proxy qui peut réécrire le Host vu par le processus Node (même mécanisme et
// même correction que googleIdentite.ts::origineIdentitePublique()).
describe("origineMetierPublique() — dérivée uniquement de GOOGLE_REDIRECT_URI", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("retourne l'origine HTTPS publique configurée en production", async () => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", "https://domiora-production.up.railway.app/api/auth/google/callback");
    const { origineMetierPublique } = await import("./oauth");
    expect(origineMetierPublique()).toBe("https://domiora-production.up.railway.app");
  });

  it("retourne localhost en développement (ne casse pas le flux local)", async () => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/google/callback");
    const { origineMetierPublique } = await import("./oauth");
    expect(origineMetierPublique()).toBe("http://localhost:3000");
  });

  it("variable absente : échoue explicitement, jamais un fallback silencieux", async () => {
    const { origineMetierPublique } = await import("./oauth");
    expect(() => origineMetierPublique()).toThrow(/GOOGLE_REDIRECT_URI/);
  });
});
