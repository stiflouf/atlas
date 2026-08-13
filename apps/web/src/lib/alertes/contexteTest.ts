// Fabriques de fixtures partagées par les suites de tests d'ADR-026 (reglesDonnees.test.ts,
// reglesCommercial.test.ts, reglesFiscal.test.ts, reglesProjection.test.ts, deduplication.test.ts,
// priorite.test.ts, moteur.test.ts). Pas un fichier *.test.ts : Vitest ne l'exécute pas comme suite.
import type { ContexteAlertes, ContexteFiscalAlertes } from "@/lib/alertes/contexte";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";
import type { ProfilFiscal } from "@/types/profilFiscal";
import type { ProvenanceRegle, ResultatFiscal } from "@/types/resultatFiscal";
import type { DonneesAnneeMicroBnc, ResultatMicroBnc, ValeurMicroBnc } from "@/lib/fiscal/microBnc";
import type { ResultatFranchiseTva } from "@/lib/fiscal/franchiseTva";
import type { EligibiliteRfr } from "@/lib/fiscal/versementLiberatoire";
import type { FiabiliteRunRate } from "@/lib/fiscal/runRate";
import type { DashboardProjectionAnnuelle, DashboardRemuneration } from "@/lib/dashboardRepository";

export function provenanceTest(code = "code-test"): ProvenanceRegle {
  return {
    code,
    categorieActivite: "agent_commercial_immobilier",
    dateDebutValidite: "2026-01-01",
    statutVerification: "verifie_direct",
    sourceLibelle: "Source de test",
    sourceUrl: "https://example.test",
  };
}

export function assietteTest(surcharge: Partial<AssietteAnnuelle> = {}): AssietteAnnuelle {
  return {
    annee: 2026,
    montantConnuCentimes: 0,
    origines: [],
    couverture: "complete",
    periodesInconnues: [],
    dateCalcul: "2026-08-13",
    ...surcharge,
  };
}

export function resultatFiscalCalcule(valeur = 0, assiette: AssietteAnnuelle = assietteTest()): ResultatFiscal<number> {
  return { statut: "calcule", valeur, provenance: [], assiette };
}

export function profilTest(surcharge: Partial<ProfilFiscal> = {}): ProfilFiscal {
  return {
    id: "profil-test",
    dossierFiscalId: "default",
    dateDebutValidite: "2026-01-01",
    natureActivite: "agent_commercial_immobilier",
    dateDebutActivite: "2020-01-01",
    regimeFiscal: "micro_bnc",
    regimeTva: "franchise",
    periodiciteUrssaf: "mensuelle",
    affiliationRetraite: "ssi_regime_general",
    creeLe: "2020-01-01T00:00:00.000Z",
    ...surcharge,
  };
}

export function donneesAnneeTest(surcharge: Partial<Extract<DonneesAnneeMicroBnc, { statut: "connue" }>> = {}): DonneesAnneeMicroBnc {
  return { statut: "connue", assiette: assietteTest(), depasse: false, ...surcharge };
}

export function valeurMicroBncTest(surcharge: Partial<ValeurMicroBnc> = {}): ValeurMicroBnc {
  return {
    plafondPleinCentimes: 8_360_000,
    provenancePlafond: provenanceTest("plafond_micro_bnc"),
    anneeCourante: donneesAnneeTest(),
    anneeCreation: false,
    ...surcharge,
  };
}

export function microBncCalcule(surcharge: Partial<ValeurMicroBnc> = {}): ResultatMicroBnc {
  return { statut: "calcule", valeur: valeurMicroBncTest(surcharge) };
}

export function contexteFiscalTest(surcharge: Partial<ContexteFiscalAlertes> = {}): ContexteFiscalAlertes {
  return {
    dossierFiscalId: "default",
    annee: 2026,
    profil: profilTest(),
    assiette: assietteTest(),
    cotisations: resultatFiscalCalcule(),
    cfp: resultatFiscalCalcule(),
    vfl: resultatFiscalCalcule(),
    eligibiliteRfr: { statut: "indisponible", raisons: [] },
    microBnc: microBncCalcule(),
    franchiseTva: { statut: "indisponible", raisons: [] } as ResultatFranchiseTva,
    runRate: { fiable: true, moisHistoriqueUtilises: 6, moyenneMensuelleCentimes: 100_000 } as FiabiliteRunRate,
    projectionsPluriannuelles: [],
    ...surcharge,
  };
}

export function remunerationTest(surcharge: Partial<DashboardRemuneration> = {}): DashboardRemuneration {
  return {
    remunerationPrevisionnelleCentimes: undefined,
    nombreRemunerationsPrevisionnellesRenseignees: 0,
    nombreCompromisEnCoursEligibles: 0,
    remunerationVenteFinaliseeNonEncaisseeCentimes: undefined,
    remunerationEncaisseeCentimes: undefined,
    nombreRemunerationsVentesFinaliseesRenseignees: 0,
    nombreVentesFinalisees: 0,
    remunerationEncaisseeParMoisCentimes: [],
    ...surcharge,
  };
}

export function projectionAnnuelleTest(surcharge: Partial<DashboardProjectionAnnuelle> = {}): DashboardProjectionAnnuelle {
  return {
    annee: 2026,
    encaisseDepuisJanvierCentimes: undefined,
    previsionnelRestantCentimes: undefined,
    nombreRemunerationsPrevisionnellesAvecDatePrevue: 0,
    encaissementsAttendusDepassesCentimes: undefined,
    nombreEncaissementsAttendusDepasses: 0,
    nombreFinaliseNonEncaisseAvecDatePrevue: 0,
    nombreFinaliseNonEncaisseRenseignees: 0,
    finaliseNonEncaisseRestantCentimes: undefined,
    nombreFinaliseNonEncaisseRestant: 0,
    ventilationMensuelle: [],
    ...surcharge,
  };
}

export function contexteTest(surcharge: Partial<ContexteAlertes> = {}): ContexteAlertes {
  return {
    dossierFiscalId: "default",
    fiscal: contexteFiscalTest(),
    remuneration: remunerationTest(),
    projectionAnnuelle: projectionAnnuelleTest(),
    ...surcharge,
  };
}
