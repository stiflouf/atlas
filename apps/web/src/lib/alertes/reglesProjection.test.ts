import { describe, expect, it } from "vitest";
import { produireAlertesProjection } from "./reglesProjection";
import { contexteFiscalTest, contexteTest, provenanceTest } from "./contexteTest";
import type {
  ConsequencesFiscalesProjetees,
  ProjectionAnneeFiscale,
  ProvenanceRegleProjection,
  ResultatFiscalProjete,
} from "@/types/projectionFiscale";

function provenanceProjOfficielle(code = "code"): ProvenanceRegleProjection {
  return { origine: "officielle", regle: provenanceTest(code) };
}

function provenanceProjHypothese(code = "code"): ProvenanceRegleProjection {
  return { origine: "hypothese_reconduction", regleReconduite: provenanceTest(code), anneeDerniereRegleOfficielle: 2026 };
}

function resultatIndisponible(): ResultatFiscalProjete<number> {
  return { statut: "indisponible", raisons: [] };
}

function consequencesTest(surcharge: Partial<ConsequencesFiscalesProjetees> = {}): ConsequencesFiscalesProjetees {
  return {
    cotisations: resultatIndisponible(),
    cfp: resultatIndisponible(),
    vfl: resultatIndisponible(),
    microBnc: { statut: "indeterminee", raisons: [] },
    franchiseTva: { statut: "indisponible", raisons: [] },
    ...surcharge,
  };
}

function projectionAnneeTest(annee: number, surcharge: Partial<ProjectionAnneeFiscale> = {}): ProjectionAnneeFiscale {
  return {
    annee,
    pipeline: { montantCentimes: undefined, nombreAvecDatePrevue: 0, consequencesFiscales: undefined },
    statistique: { montantCentimes: undefined, moisHistoriqueUtilises: 0, ventilationMensuelle: undefined, consequencesFiscales: undefined },
    hypothese: undefined,
    ...surcharge,
  };
}

describe("D1 — dépassement projeté (jamais un verdict, pipeline et statistique jamais additionnés)", () => {
  it("se déclenche sur un dépassement micro-BNC projeté côté pipeline", () => {
    const alertes = produireAlertesProjection(
      contexteTest({
        fiscal: contexteFiscalTest({
          projectionsPluriannuelles: [
            projectionAnneeTest(2027, {
              pipeline: {
                montantCentimes: 9_000_000,
                nombreAvecDatePrevue: 3,
                consequencesFiscales: consequencesTest({
                  microBnc: { statut: "connue", depasse: true, plafondCentimes: 8_360_000, provenance: provenanceProjOfficielle() },
                }),
              },
            }),
          ],
        }),
      })
    );
    const alerte = alertes.find((a) => a.type === "depassement_projete");
    expect(alerte).toBeDefined();
    expect(alerte?.donneesDeclencheuses.annee).toBe(2027);
    expect(alerte?.explication).toContain("pipeline");
    expect(alerte?.explication.toLowerCase()).toContain("projection");
    expect(alerte?.explication.toLowerCase()).not.toMatch(/certitude juridique|vous devez|verdict définitif/);
  });

  it("se déclenche sur un seuil de TVA déjà dépassé côté tendance statistique", () => {
    const alertes = produireAlertesProjection(
      contexteTest({
        fiscal: contexteFiscalTest({
          projectionsPluriannuelles: [
            projectionAnneeTest(2028, {
              statistique: {
                montantCentimes: 9_000_000,
                moisHistoriqueUtilises: 8,
                ventilationMensuelle: undefined,
                consequencesFiscales: consequencesTest({
                  franchiseTva: {
                    statut: "connue",
                    margeAvantSeuilBaseCentimes: -10_000,
                    margeAvantSeuilMajoreCentimes: 5_000,
                    provenanceSeuilBase: provenanceProjOfficielle(),
                    provenanceSeuilMajore: provenanceProjOfficielle(),
                  },
                }),
              },
            }),
          ],
        }),
      })
    );
    const alerte = alertes.find((a) => a.type === "depassement_projete");
    expect(alerte).toBeDefined();
    expect(alerte?.explication).toContain("tendance statistique");
  });

  it("ne se déclenche pas sans aucun dépassement projeté", () => {
    const alertes = produireAlertesProjection(
      contexteTest({ fiscal: contexteFiscalTest({ projectionsPluriannuelles: [projectionAnneeTest(2027)] }) })
    );
    expect(alertes.find((a) => a.type === "depassement_projete")).toBeUndefined();
  });
});

describe("D3 — règles futures hypothétiques, regroupées globalement sur tout l'horizon", () => {
  it("se déclenche une seule fois même si plusieurs années/codes sont en reconduction hypothétique", () => {
    const alertes = produireAlertesProjection(
      contexteTest({
        fiscal: contexteFiscalTest({
          projectionsPluriannuelles: [
            projectionAnneeTest(2027, {
              pipeline: {
                montantCentimes: 100,
                nombreAvecDatePrevue: 1,
                consequencesFiscales: consequencesTest({ cotisations: { statut: "calcule", valeur: 10, provenance: [provenanceProjHypothese("taux_a")] } }),
              },
            }),
            projectionAnneeTest(2028, {
              statistique: {
                montantCentimes: 100,
                moisHistoriqueUtilises: 8,
                ventilationMensuelle: undefined,
                consequencesFiscales: consequencesTest({ cfp: { statut: "calcule", valeur: 10, provenance: [provenanceProjHypothese("taux_b")] } }),
              },
            }),
            projectionAnneeTest(2029),
            projectionAnneeTest(2030),
            projectionAnneeTest(2031),
          ],
        }),
      })
    );
    const alertesReconduction = alertes.filter((a) => a.type === "regles_futures_hypothetiques");
    expect(alertesReconduction).toHaveLength(1);
    expect(alertesReconduction[0].titre).toContain("2027");
    expect(alertesReconduction[0].titre).toContain("2031");
    expect(alertesReconduction[0].niveau).toBe("information");
  });

  it("ne se déclenche pas si toutes les règles rencontrées sont officielles", () => {
    const alertes = produireAlertesProjection(
      contexteTest({
        fiscal: contexteFiscalTest({
          projectionsPluriannuelles: [
            projectionAnneeTest(2027, {
              pipeline: {
                montantCentimes: 100,
                nombreAvecDatePrevue: 1,
                consequencesFiscales: consequencesTest({ cotisations: { statut: "calcule", valeur: 10, provenance: [provenanceProjOfficielle()] } }),
              },
            }),
          ],
        }),
      })
    );
    expect(alertes.find((a) => a.type === "regles_futures_hypothetiques")).toBeUndefined();
  });

  it("reste indépendante de l'assiette (jamais absorbée par A3/A7, cause distincte)", () => {
    const alertes = produireAlertesProjection(
      contexteTest({
        fiscal: contexteFiscalTest({
          assiette: { annee: 2026, montantConnuCentimes: 0, origines: [], couverture: "partielle", periodesInconnues: [{ debut: "2026-01-01", fin: "2026-08-13" }], dateCalcul: "2026-08-13" },
          projectionsPluriannuelles: [
            projectionAnneeTest(2027, {
              pipeline: {
                montantCentimes: 100,
                nombreAvecDatePrevue: 1,
                consequencesFiscales: consequencesTest({ cotisations: { statut: "calcule", valeur: 10, provenance: [provenanceProjHypothese()] } }),
              },
            }),
          ],
        }),
      })
    );
    expect(alertes.find((a) => a.type === "regles_futures_hypothetiques")).toBeDefined();
  });
});
