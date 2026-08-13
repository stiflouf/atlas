import {
  calculerConsequencesFiscalesHypothese,
  calculerConsequencesFiscalesProjetees,
} from "@/lib/fiscal/consequencesFiscalesProjetees";
import { ventilerRunRateSurAnnee } from "@/lib/fiscal/runRate";
import type { FiabiliteRunRate } from "@/lib/fiscal/runRate";
import type { TrancheProjetee } from "@/lib/fiscal/resolutionTrancheProjetee";
import type { BlocPipeline, BlocStatistique, ProjectionAnneeFiscale } from "@/types/projectionFiscale";

// ADR-025, correction obligatoire n° 1 : compose une année de projection à partir de blocs
// STRICTEMENT séparés — pipeline et statistique restent deux lectures indépendantes du même CA
// futur possible, jamais additionnées (aucun champ "total" n'existe sur ProjectionAnneeFiscale).
export async function calculerProjectionAnnuelle(
  dossierFiscalId: string,
  annee: number,
  itemsPipelineAnnee: TrancheProjetee[],
  fiabiliteRunRate: FiabiliteRunRate,
  hypotheseAnnuelleCentimes?: number
): Promise<ProjectionAnneeFiscale> {
  const montantPipelineCentimes =
    itemsPipelineAnnee.length > 0 ? itemsPipelineAnnee.reduce((somme, i) => somme + i.montantCentimes, 0) : undefined;
  const pipeline: BlocPipeline = {
    montantCentimes: montantPipelineCentimes,
    nombreAvecDatePrevue: itemsPipelineAnnee.length,
    consequencesFiscales:
      montantPipelineCentimes !== undefined
        ? await calculerConsequencesFiscalesProjetees(dossierFiscalId, annee, itemsPipelineAnnee)
        : undefined,
  };

  let statistique: BlocStatistique;
  if (fiabiliteRunRate.fiable) {
    // Ventilation mensuelle plate (correction n° 4), jamais un montant annuel unique appliqué au
    // dernier taux — chaque mois est résolu à sa propre date pour capter un éventuel changement de
    // taux/régime/fin d'ACRE en cours de l'année cible.
    const ventilationMensuelle = ventilerRunRateSurAnnee(annee, fiabiliteRunRate.moyenneMensuelleCentimes);
    const tranchesMensuelles: TrancheProjetee[] = ventilationMensuelle.map((m) => ({
      montantCentimes: m.montantCentimes,
      date: `${m.mois}-15`,
    }));
    statistique = {
      montantCentimes: fiabiliteRunRate.moyenneMensuelleCentimes * 12,
      moisHistoriqueUtilises: fiabiliteRunRate.moisHistoriqueUtilises,
      ventilationMensuelle,
      consequencesFiscales: await calculerConsequencesFiscalesProjetees(dossierFiscalId, annee, tranchesMensuelles),
    };
  } else {
    statistique = {
      montantCentimes: undefined,
      moisHistoriqueUtilises: fiabiliteRunRate.moisHistoriqueUtilises,
      ventilationMensuelle: undefined,
      consequencesFiscales: undefined,
    };
  }

  const hypothese =
    hypotheseAnnuelleCentimes !== undefined
      ? {
          montantAnnuelCentimes: hypotheseAnnuelleCentimes,
          consequencesFiscales: await calculerConsequencesFiscalesHypothese(dossierFiscalId, annee, hypotheseAnnuelleCentimes),
        }
      : undefined;

  return { annee, pipeline, statistique, hypothese };
}
