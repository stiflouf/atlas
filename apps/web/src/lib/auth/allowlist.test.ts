import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estEmailAutorise, normaliserEmail } from "./allowlist";

describe("allowlist (ADR-047) — mono-conseiller, une seule adresse autorisée", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normaliserEmail() trim et lowercase de façon déterministe", () => {
    expect(normaliserEmail("  Conseiller@Example.com  ")).toBe("conseiller@example.com");
  });

  it("email exactement autorisé (déjà normalisé) est accepté", () => {
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", "conseiller@example.com");
    expect(estEmailAutorise("conseiller@example.com")).toBe(true);
  });

  it("email autorisé avec casse/espaces différents est accepté (normalisation des deux côtés)", () => {
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", "  Conseiller@Example.com");
    expect(estEmailAutorise("conseiller@example.com")).toBe(true);
  });

  it("email différent est refusé", () => {
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", "conseiller@example.com");
    expect(estEmailAutorise("quelquun-dautre@example.com")).toBe(false);
  });

  it("fail-closed : ATLAS_ALLOWED_EMAIL absent refuse plutôt que d'autoriser tout le monde", () => {
    vi.stubEnv("ATLAS_ALLOWED_EMAIL", "");
    expect(() => estEmailAutorise("conseiller@example.com")).toThrow();
  });
});
