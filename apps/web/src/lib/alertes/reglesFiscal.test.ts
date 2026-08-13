import { describe, expect, it } from "vitest";
import { produireAlertesFiscal } from "./reglesFiscal";
import { contexteFiscalTest, contexteTest, donneesAnneeTest, microBncCalcule, profilTest } from "./contexteTest";

describe("C1 — dépassement micro-BNC constaté (uniquement sur couverture complète)", () => {
  it("se déclenche quand l'année courante, connue, dépasse le plafond", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({ fiscal: contexteFiscalTest({ microBnc: microBncCalcule({ anneeCourante: donneesAnneeTest({ depasse: true }) }) }) })
    );
    expect(alertes.find((a) => a.type === "depassement_micro_constate")).toBeDefined();
  });

  it("ne se déclenche pas si l'année courante ne dépasse pas", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({ fiscal: contexteFiscalTest({ microBnc: microBncCalcule({ anneeCourante: donneesAnneeTest({ depasse: false }) }) }) })
    );
    expect(alertes.find((a) => a.type === "depassement_micro_constate")).toBeUndefined();
  });

  it("ne se déclenche jamais sur une année indéterminée (couverture partielle) — jamais un verdict sur du connu partiel", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          microBnc: microBncCalcule({ anneeCourante: { statut: "indeterminee", assiette: { annee: 2026, montantConnuCentimes: 9_000_000, origines: [], couverture: "partielle", periodesInconnues: [{ debut: "2026-01-01", fin: "2026-08-13" }], dateCalcul: "2026-08-13" } } }),
        }),
      })
    );
    expect(alertes.find((a) => a.type === "depassement_micro_constate")).toBeUndefined();
  });

  it("ne se déclenche jamais avec un verdict affirmatif de sortie du régime", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({ fiscal: contexteFiscalTest({ microBnc: microBncCalcule({ anneeCourante: donneesAnneeTest({ depasse: true }) }) }) })
    );
    const alerte = alertes.find((a) => a.type === "depassement_micro_constate")!;
    expect(alerte.explication).not.toMatch(/vous sortez (automatiquement )?du régime/i);
  });
});

describe("C2 — deux années consécutives de dépassement", () => {
  it("se déclenche quand année courante ET année précédente, connues, dépassent toutes deux", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          microBnc: microBncCalcule({ anneeCourante: donneesAnneeTest({ depasse: true }), anneeMoins1: donneesAnneeTest({ depasse: true }) }),
        }),
      })
    );
    expect(alertes.find((a) => a.type === "deux_annees_depassement")).toBeDefined();
  });

  it("ne se déclenche pas si l'année précédente n'est pas connue", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({ fiscal: contexteFiscalTest({ microBnc: microBncCalcule({ anneeCourante: donneesAnneeTest({ depasse: true }) }) }) })
    );
    expect(alertes.find((a) => a.type === "deux_annees_depassement")).toBeUndefined();
  });

  it("ne se déclenche pas si une seule des deux années dépasse", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          microBnc: microBncCalcule({ anneeCourante: donneesAnneeTest({ depasse: true }), anneeMoins1: donneesAnneeTest({ depasse: false }) }),
        }),
      })
    );
    expect(alertes.find((a) => a.type === "deux_annees_depassement")).toBeUndefined();
  });
});

describe("C4 — VFL actif mais éligibilité RFR non vérifiable (jamais le calcul VFL lui-même remis en cause)", () => {
  it("se déclenche quand le VFL est actif et le RFR absent", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          profil: profilTest({ regimeFiscal: "micro_bnc", optionVersementLiberatoire: true }),
          eligibiliteRfr: { statut: "indisponible", raisons: [{ type: "rfr_absent", anneeRfrAttendue: 2024 }] },
        }),
      })
    );
    const alerte = alertes.find((a) => a.type === "eligibilite_vfl_non_verifiable");
    expect(alerte).toBeDefined();
    expect(alerte?.action?.href).toBe("/fiscal#rfr");
    expect(alerte?.explication).not.toMatch(/versement libératoire (n'est pas|reste) incertain/i);
  });

  it("ne se déclenche pas si le VFL n'est pas actif", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          profil: profilTest({ regimeFiscal: "micro_bnc", optionVersementLiberatoire: false }),
          eligibiliteRfr: { statut: "indisponible", raisons: [{ type: "rfr_absent", anneeRfrAttendue: 2024 }] },
        }),
      })
    );
    expect(alertes.find((a) => a.type === "eligibilite_vfl_non_verifiable")).toBeUndefined();
  });

  it("ne se déclenche pas si le RFR est calculé normalement", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          profil: profilTest({ regimeFiscal: "micro_bnc", optionVersementLiberatoire: true }),
          eligibiliteRfr: { statut: "calcule", eligible: true, rfrParPartCentimes: 100, seuilCentimes: 200, provenance: { code: "x", categorieActivite: "y", dateDebutValidite: "2026-01-01", statutVerification: "verifie_direct", sourceLibelle: "s", sourceUrl: "https://x" } },
        }),
      })
    );
    expect(alertes.find((a) => a.type === "eligibilite_vfl_non_verifiable")).toBeUndefined();
  });

  it("ne se déclenche pas si l'indisponibilité du RFR vient d'une règle absente (couvert par A6, pas C4)", () => {
    const alertes = produireAlertesFiscal(
      contexteTest({
        fiscal: contexteFiscalTest({
          profil: profilTest({ regimeFiscal: "micro_bnc", optionVersementLiberatoire: true }),
          eligibiliteRfr: { statut: "indisponible", raisons: [{ type: "regle_absente", code: "seuil_rfr_versement_liberatoire_par_part", date: "2026-01-01" }] },
        }),
      })
    );
    expect(alertes.find((a) => a.type === "eligibilite_vfl_non_verifiable")).toBeUndefined();
  });
});
