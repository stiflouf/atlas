import { describe, expect, it } from "vitest";
import { deriverEtatRemuneration, formatMontantCentimes, parseMontantCentimes, type Remuneration } from "./remuneration";

function remunerationTest(surcharge: Partial<Remuneration> = {}): Remuneration {
  return {
    id: "remuneration-test",
    compromisId: "compromis-test",
    montantRemunerationConseillerCentimes: 1000000,
    creeLe: "2026-08-01T10:00:00.000Z",
    ...surcharge,
  };
}

describe("parseMontantCentimes", () => {
  it("convertit un montant à 2 décimales en centimes exacts, sans multiplication flottante", () => {
    // "12487.36" * 100 en JS produit 1248735.9999999998 — cas connu pour casser une conversion
    // flottante naïve, d'où l'assertion sur cette valeur précise.
    expect(parseMontantCentimes("12487.36")).toBe(1248736);
  });

  it("accepte le séparateur virgule au même titre que le point", () => {
    expect(parseMontantCentimes("12487,36")).toBe(1248736);
  });

  it("complète à 2 décimales une saisie à 1 décimale", () => {
    expect(parseMontantCentimes("12487.3")).toBe(1248730);
  });

  it("complète à 2 décimales une saisie sans décimale", () => {
    expect(parseMontantCentimes("12487")).toBe(1248700);
  });

  it("gère un montant connu pour casser une multiplication flottante (0.29 * 100 = 28.999999999999996 en JS)", () => {
    expect(parseMontantCentimes("0.29")).toBe(29);
  });

  it("retourne undefined pour une entrée vide, négative, non numérique ou à plus de 2 décimales", () => {
    expect(parseMontantCentimes("")).toBeUndefined();
    expect(parseMontantCentimes("-100")).toBeUndefined();
    expect(parseMontantCentimes("abc")).toBeUndefined();
    expect(parseMontantCentimes("100.123")).toBeUndefined();
  });
});

// Réplique le formatage de remuneration.ts (toLocaleString produit des espaces insécables
// spéciales, pas des espaces classiques — comparer via ce même formateur plutôt qu'une chaîne
// littérale codée en dur évite un faux échec dépendant de l'environnement ICU, même principe que
// historiqueBien.test.ts).
describe("formatMontantCentimes", () => {
  it("formate des centimes en euros avec 2 décimales, séparateur virgule", () => {
    expect(formatMontantCentimes(1248736)).toBe(`${(12487).toLocaleString("fr-FR")},36 €`);
  });

  it("formate un montant rond sans perdre les décimales à 00", () => {
    expect(formatMontantCentimes(1000000)).toBe(`${(10000).toLocaleString("fr-FR")},00 €`);
  });
});

describe("deriverEtatRemuneration", () => {
  it("retourne toujours undefined pour un compromis annulé, même avec dateEncaissementReelle renseignée (donnée incohérente)", () => {
    const r = remunerationTest({ dateEncaissementReelle: "2026-09-01" });
    expect(deriverEtatRemuneration(r, "annule")).toBeUndefined();
  });

  it("retourne 'associee_vente_finalisee' pour un compromis realise sans dateEncaissementReelle", () => {
    const r = remunerationTest();
    expect(deriverEtatRemuneration(r, "realise")).toBe("associee_vente_finalisee");
  });

  it("retourne 'encaissee' pour un compromis realise avec dateEncaissementReelle", () => {
    const r = remunerationTest({ dateEncaissementReelle: "2026-09-01" });
    expect(deriverEtatRemuneration(r, "realise")).toBe("encaissee");
  });

  it("retourne 'previsionnelle' pour un compromis en_cours, quelle que soit dateEncaissementReelle", () => {
    const sansDate = remunerationTest();
    const avecDateIncoherente = remunerationTest({ dateEncaissementReelle: "2026-09-01" });
    expect(deriverEtatRemuneration(sansDate, "en_cours")).toBe("previsionnelle");
    expect(deriverEtatRemuneration(avecDateIncoherente, "en_cours")).toBe("previsionnelle");
  });
});
