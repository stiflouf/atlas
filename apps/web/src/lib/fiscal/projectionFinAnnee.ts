import { chargerProjectionAnnuelle } from "@/lib/dashboardRepository";
import { calculerAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";

export type BlocProjection = {
  montantCentimes: number | undefined; // undefined ssi aucune dateEncaissementPrevue connue dans sa population
  nombreAvecDatePrevue: number; // couverture : combien de lignes de la population ont une date connue
};

// ADR-024, point 4 : trois blocs strictement distincts, jamais fusionnés silencieusement. Une
// rémunération sans dateEncaissementPrevue n'est placée dans AUCUN des deux blocs "restant" — même
// convention que ADR-022 (previsionnelRestantCentimes/encaissementsAttendusDepassesCentimes).
export type ProjectionFinAnnee = {
  annee: number;
  // Bloc 1 : montant réellement connu à date (encaissements Atlas + amorçage confirmé) — jamais
  // additionné aux deux blocs suivants sans vérifier qu'ils sont eux-mêmes connus.
  encaisseReel: AssietteAnnuelle;
  // Bloc 2 : ventes finalisées (compromis realise) non encore encaissées, dont la date prévue tombe
  // entre aujourd'hui et le 31/12 — biens archivés inclus (ADR-021, le suivi financier historique
  // n'est jamais bloqué par l'archivage).
  finaliseNonEncaisseRestant: BlocProjection;
  // Bloc 3 : compromis encore en_cours, biens non archivés, dont la date prévue tombe dans la même
  // fenêtre — jamais fusionné avec le bloc 2 (ADR-022, "en_cours uniquement").
  compromisEnCoursRestant: BlocProjection;
  // Somme des trois blocs, uniquement si les deux blocs "restant" sont tous deux des nombres connus
  // (encaisseReel.montantConnuCentimes est toujours un nombre, mais sa fiabilité se lit via
  // encaisseReel.couverture, jamais fusionnée ici avec l'undefined des deux autres blocs).
  projectionCouverteFinAnneeCentimes: number | undefined;
};

// dashboardRepository.chargerProjectionAnnuelle() n'a pas de paramètre année : elle est ancrée sur
// CURRENT_DATE côté Postgres (ADR-022). Cette fonction n'a donc de sens que pour l'année civile en
// cours, cohérent avec le périmètre V1 d'ADR-024 (aucune projection N+1 à N+5, réservée à ADR-025).
export async function calculerProjectionFinAnnee(dossierFiscalId: string, annee: number): Promise<ProjectionFinAnnee> {
  const [encaisseReel, dashboard] = await Promise.all([
    calculerAssietteAnnuelle(dossierFiscalId, annee),
    chargerProjectionAnnuelle(),
  ]);

  const finaliseNonEncaisseRestant: BlocProjection = {
    montantCentimes: dashboard.finaliseNonEncaisseRestantCentimes,
    nombreAvecDatePrevue: dashboard.nombreFinaliseNonEncaisseRestant,
  };
  const compromisEnCoursRestant: BlocProjection = {
    montantCentimes: dashboard.previsionnelRestantCentimes,
    nombreAvecDatePrevue: dashboard.nombreRemunerationsPrevisionnellesAvecDatePrevue,
  };

  const projectionCouverteFinAnneeCentimes =
    finaliseNonEncaisseRestant.montantCentimes === undefined || compromisEnCoursRestant.montantCentimes === undefined
      ? undefined
      : encaisseReel.montantConnuCentimes +
        finaliseNonEncaisseRestant.montantCentimes +
        compromisEnCoursRestant.montantCentimes;

  return { annee, encaisseReel, finaliseNonEncaisseRestant, compromisEnCoursRestant, projectionCouverteFinAnneeCentimes };
}
