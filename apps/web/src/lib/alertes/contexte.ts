import { obtenirDossierFiscalDefaut } from "@/lib/dossierFiscalRepository";
import { chargerProfilFiscalActuel } from "@/lib/profilFiscalRepository";
import { calculerAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import { calculerCotisationsSociales } from "@/lib/fiscal/cotisationsSociales";
import { calculerCfp } from "@/lib/fiscal/cfp";
import { calculerVersementLiberatoire, verifierEligibiliteRfr } from "@/lib/fiscal/versementLiberatoire";
import { calculerMicroBnc } from "@/lib/fiscal/microBnc";
import { calculerFranchiseTva } from "@/lib/fiscal/franchiseTva";
import { evaluerRunRate } from "@/lib/fiscal/runRate";
import { calculerProjectionPluriannuelle, HORIZON_PROJECTION_ANNEES } from "@/lib/fiscal/projectionPluriannuelle";
import { chargerRemuneration, chargerProjectionAnnuelle } from "@/lib/dashboardRepository";
import type { DashboardProjectionAnnuelle, DashboardRemuneration } from "@/lib/dashboardRepository";
import type { ProfilFiscal } from "@/types/profilFiscal";
import type { ResultatFiscal } from "@/types/resultatFiscal";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";
import type { ResultatMicroBnc } from "@/lib/fiscal/microBnc";
import type { ResultatFranchiseTva } from "@/lib/fiscal/franchiseTva";
import type { EligibiliteRfr } from "@/lib/fiscal/versementLiberatoire";
import type { FiabiliteRunRate } from "@/lib/fiscal/runRate";
import type { ProjectionAnneeFiscale } from "@/types/projectionFiscale";

// Sous-ensemble du contexte qui n'existe que si un profil fiscal est renseigné — toute règle A2+
// dépend de ces données, jamais calculées quand `fiscal` est absent (évite à la fois du travail
// inutile et une cascade d'alertes qui ne feraient que reformuler l'absence de profil, cf. A1).
export type ContexteFiscalAlertes = {
  dossierFiscalId: string;
  annee: number;
  profil: ProfilFiscal;
  assiette: AssietteAnnuelle;
  cotisations: ResultatFiscal<number>;
  cfp: ResultatFiscal<number>;
  vfl: ResultatFiscal<number>;
  eligibiliteRfr: EligibiliteRfr;
  microBnc: ResultatMicroBnc;
  franchiseTva: ResultatFranchiseTva;
  runRate: FiabiliteRunRate;
  // N+1 → N+5 (ADR-025) — pipeline et statistique restent deux blocs séparés à l'intérieur de
  // chaque année, jamais fusionnés (voir reglesProjection.ts).
  projectionsPluriannuelles: ProjectionAnneeFiscale[];
};

export type ContexteAlertes = {
  dossierFiscalId: string;
  fiscal: ContexteFiscalAlertes | undefined;
  remuneration: DashboardRemuneration;
  projectionAnnuelle: DashboardProjectionAnnuelle;
};

// Point d'entrée unique consommé par moteur.ts : assemble les résultats déjà exposés par les
// moteurs ADR-022→025 — aucun nouveau repository, aucune requête Drizzle écrite ici (ADR-026).
export async function chargerContexteAlertes(): Promise<ContexteAlertes> {
  const dossierFiscalId = await obtenirDossierFiscalDefaut();
  const anneeCourante = new Date().getFullYear();

  const [profil, remuneration, projectionAnnuelle] = await Promise.all([
    chargerProfilFiscalActuel(dossierFiscalId),
    chargerRemuneration(),
    chargerProjectionAnnuelle(),
  ]);

  let fiscal: ContexteFiscalAlertes | undefined;
  if (profil) {
    const [
      assiette,
      cotisations,
      cfp,
      vfl,
      eligibiliteRfr,
      microBnc,
      franchiseTva,
      runRate,
      projectionsPluriannuelles,
    ] = await Promise.all([
      calculerAssietteAnnuelle(dossierFiscalId, anneeCourante),
      calculerCotisationsSociales(dossierFiscalId, anneeCourante),
      calculerCfp(dossierFiscalId, anneeCourante),
      calculerVersementLiberatoire(dossierFiscalId, anneeCourante),
      verifierEligibiliteRfr(dossierFiscalId, anneeCourante),
      calculerMicroBnc(dossierFiscalId, anneeCourante),
      calculerFranchiseTva(dossierFiscalId, anneeCourante),
      evaluerRunRate(dossierFiscalId),
      calculerProjectionPluriannuelle(dossierFiscalId, anneeCourante + 1, HORIZON_PROJECTION_ANNEES),
    ]);
    fiscal = {
      dossierFiscalId,
      annee: anneeCourante,
      profil,
      assiette,
      cotisations,
      cfp,
      vfl,
      eligibiliteRfr,
      microBnc,
      franchiseTva,
      runRate,
      projectionsPluriannuelles,
    };
  }

  return { dossierFiscalId, fiscal, remuneration, projectionAnnuelle };
}
