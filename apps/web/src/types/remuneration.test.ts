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

// DEMO_UX_HARDENING_V1 — un montant recopié depuis un tableur, un PDF ou un relevé arrive avec des
// espaces (insécables compris) et parfois le symbole €. C'est du bruit de présentation, pas une
// valeur différente : il est retiré avant lecture. Ce qui reste AMBIGU l'est toujours refusé.
describe("parseMontantCentimes — formats humains", () => {
  it("accepte les espaces de milliers : ASCII, insécable (U+00A0), insécable étroite (U+202F)", () => {
    expect(parseMontantCentimes("45 000")).toBe(4500000);
    expect(parseMontantCentimes("45\u00a0000")).toBe(4500000);
    expect(parseMontantCentimes("45\u202f000")).toBe(4500000);
    expect(parseMontantCentimes("1 234 567,89")).toBe(123456789);
  });

  it("accepte le symbole € et les espaces qui l'entourent", () => {
    expect(parseMontantCentimes("45000 €")).toBe(4500000);
    expect(parseMontantCentimes("45 000 €")).toBe(4500000);
    expect(parseMontantCentimes("€45000,50")).toBe(4500050);
  });

  it("n'altère pas les formats déjà acceptés", () => {
    expect(parseMontantCentimes("45000")).toBe(4500000);
    expect(parseMontantCentimes("45000,50")).toBe(4500050);
    expect(parseMontantCentimes("45000.50")).toBe(4500050);
    expect(parseMontantCentimes("0")).toBe(0);
  });

  it("REFUSE les séparateurs de milliers ambigus plutôt que de deviner — un facteur mille se paie cher", () => {
    expect(parseMontantCentimes("30.000,00")).toBeUndefined();
    expect(parseMontantCentimes("30,000.00")).toBeUndefined();
    // "30.000" est refusé pour une autre raison, antérieure : trois décimales. Assertion conservée
    // pour documenter que la tolérance ajoutée ne l'a pas rendu acceptable par inadvertance.
    expect(parseMontantCentimes("30.000")).toBeUndefined();
  });

  it("refuse toujours ce qui n'est pas un nombre positif à deux décimales", () => {
    expect(parseMontantCentimes("abc")).toBeUndefined();
    expect(parseMontantCentimes("")).toBeUndefined();
    expect(parseMontantCentimes("€")).toBeUndefined();
    expect(parseMontantCentimes("-100")).toBeUndefined();
    expect(parseMontantCentimes("100,123")).toBeUndefined();
  });
});

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
