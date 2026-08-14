import { describe, expect, it } from "vitest";
import { formatDateRelative, joursCivilsEcoules } from "./temps";

describe("formatDateRelative", () => {
  it("retourne « Demain » pour J+1", () => {
    expect(formatDateRelative("2026-08-12", "2026-08-11")).toBe("Demain");
  });

  it("retourne un format court jour/mois pour une date plus lointaine", () => {
    // 2026-08-18 est un mardi.
    expect(formatDateRelative("2026-08-18", "2026-08-11")).toBe("mar. 18 août");
  });

  it("gère le passage de mois (J+1 en fin de mois)", () => {
    expect(formatDateRelative("2026-09-01", "2026-08-31")).toBe("Demain");
  });
});

describe("joursCivilsEcoules", () => {
  it("retourne 0 pour le même instant", () => {
    const date = new Date("2026-08-14T10:00:00Z");
    expect(joursCivilsEcoules(date, date, "Europe/Paris")).toBe(0);
  });

  it("retourne 1 pour deux instants séparés par un vrai jour civil (même s'ils sont proches en heures)", () => {
    // 23h locales le 14 août, 01h locales le 15 août (Europe/Paris, été = UTC+2) — 2h d'écart
    // réelles seulement, mais un vrai changement de jour civil.
    const veille = new Date("2026-08-14T21:00:00Z");
    const lendemain = new Date("2026-08-14T23:30:00Z");
    expect(joursCivilsEcoules(veille, lendemain, "Europe/Paris")).toBe(1);
  });

  it("retourne 7 pour un écart de 7 jours civils", () => {
    const reference = new Date("2026-08-01T08:00:00Z");
    const maintenant = new Date("2026-08-08T08:00:00Z");
    expect(joursCivilsEcoules(reference, maintenant, "Europe/Paris")).toBe(7);
  });

  it("reste correct de part et d'autre du changement d'heure été/hiver (passage à l'heure d'été, nuit du 28 au 29 mars 2026) — jamais une simple division par 86400000", () => {
    // 14h locales (UTC+1, avant le changement) le 28 mars -> 00h locales (encore UTC+1, le
    // changement n'a lieu qu'à 2h locales) le 29 mars : un vrai jour civil de plus, mais seulement
    // 10h d'écart réel. Une division ms/86400000 arrondirait ceci à 0, jamais à 1.
    const reference = new Date("2026-03-28T13:00:00Z");
    const maintenant = new Date("2026-03-28T23:00:00Z");
    expect(joursCivilsEcoules(reference, maintenant, "Europe/Paris")).toBe(1);
  });

  it("compte correctement 7 jours civils en enjambant le changement d'heure d'été (nuit du 28 au 29 mars 2026)", () => {
    const reference = new Date("2026-03-25T10:00:00Z");
    const maintenant = new Date("2026-04-01T10:00:00Z");
    expect(joursCivilsEcoules(reference, maintenant, "Europe/Paris")).toBe(7);
  });
});
