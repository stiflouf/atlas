import { listerPipelineDate } from "@/lib/dashboardRepository";
import { evaluerRunRate } from "@/lib/fiscal/runRate";
import { calculerProjectionAnnuelle } from "@/lib/fiscal/projectionAnnuelle";
import type { TrancheProjetee } from "@/lib/fiscal/resolutionTrancheProjetee";
import type { ProjectionAnneeFiscale } from "@/types/projectionFiscale";

export const HORIZON_PROJECTION_ANNEES = 5;

// Point d'entrée ADR-025 : horizon N+1 à N+5 (ou tout horizon demandé). Pipeline daté récupéré une
// seule fois pour toute la fenêtre (jamais une requête par année), run-rate évalué une seule fois
// (même profondeur historique pour toutes les années projetées) — composés année par année via
// calculerProjectionAnnuelle, qui ne mélange jamais pipeline et statistique entre elles.
//
// hypotheses : montants annuels temporaires saisis par l'utilisateur pour CETTE requête uniquement
// (correction n° 5) — jamais persistés, jamais une migration associée dans cette passe.
export async function calculerProjectionPluriannuelle(
  dossierFiscalId: string,
  anneeDebut: number,
  nombreAnnees: number = HORIZON_PROJECTION_ANNEES,
  hypotheses?: Record<number, number>
): Promise<ProjectionAnneeFiscale[]> {
  const anneeFin = anneeDebut + nombreAnnees - 1;
  const [{ finaliseNonEncaisse, compromisEnCours }, fiabiliteRunRate] = await Promise.all([
    listerPipelineDate(anneeDebut, anneeFin),
    evaluerRunRate(dossierFiscalId),
  ]);

  const itemsPipeline: TrancheProjetee[] = [...finaliseNonEncaisse, ...compromisEnCours].map((item) => ({
    montantCentimes: item.montantCentimes,
    date: item.datePrevue,
  }));

  const annees = Array.from({ length: nombreAnnees }, (_, index) => anneeDebut + index);
  return Promise.all(
    annees.map((annee) => {
      const itemsPipelineAnnee = itemsPipeline.filter((item) => item.date.slice(0, 4) === String(annee));
      return calculerProjectionAnnuelle(dossierFiscalId, annee, itemsPipelineAnnee, fiabiliteRunRate, hypotheses?.[annee]);
    })
  );
}
