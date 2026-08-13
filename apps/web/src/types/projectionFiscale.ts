import type { ProvenanceRegle, RaisonIndisponibilite } from "@/types/resultatFiscal";

// ADR-025. Enveloppe une ProvenanceRegle (ADR-024) avec sa confiance pour une DATE FUTURE :
// dateFinValidite = NULL ne prouve jamais qu'une règle est officiellement connue pour une année
// lointaine — seule une fin de validité explicitement publiée et postérieure à la date le prouve
// (correction obligatoire n° 3). "hypothese_reconduction" ne matérialise jamais de ligne en base.
export type ProvenanceRegleProjection =
  | { origine: "officielle"; regle: ProvenanceRegle }
  | { origine: "hypothese_reconduction"; regleReconduite: ProvenanceRegle; anneeDerniereRegleOfficielle: number }
  | { origine: "indisponible"; code: string };

// Raison propre aux calculs projetés, en plus des raisons ADR-024 : une tranche projetée dont le
// régime/la règle change en cours de période et qui ne peut être ventilée n'est jamais répartie
// arbitrairement (correction n° 4).
export type RaisonIndisponibiliteProjection = RaisonIndisponibilite | { type: "ventilation_requise"; annee: number };

// Même contrat que ResultatFiscal<T> (ADR-024) — jamais un number nu — avec une provenance élargie
// à ProvenanceRegleProjection.
export type ResultatFiscalProjete<T> =
  | { statut: "calcule"; valeur: T; provenance: ProvenanceRegleProjection[] }
  | { statut: "partiel"; valeurConnue: T; provenance: ProvenanceRegleProjection[]; raisons: RaisonIndisponibiliteProjection[] }
  | { statut: "indisponible"; raisons: RaisonIndisponibiliteProjection[] };

// Jamais un verdict de sortie/changement de régime — uniquement des faits datés et leur couverture
// (même philosophie que microBnc.ts, ADR-024).
export type StatutRegimeMicroBncProjete =
  | { statut: "connue"; depasse: boolean; plafondCentimes: number; provenance: ProvenanceRegleProjection }
  | { statut: "indeterminee"; raisons: RaisonIndisponibiliteProjection[] };

export type SeuilTvaProjete =
  | {
      statut: "connue";
      margeAvantSeuilBaseCentimes: number;
      margeAvantSeuilMajoreCentimes: number;
      provenanceSeuilBase: ProvenanceRegleProjection;
      provenanceSeuilMajore: ProvenanceRegleProjection;
    }
  | { statut: "indisponible"; raisons: RaisonIndisponibiliteProjection[] };

export type ConsequencesFiscalesProjetees = {
  cotisations: ResultatFiscalProjete<number>;
  cfp: ResultatFiscalProjete<number>;
  vfl: ResultatFiscalProjete<number>;
  microBnc: StatutRegimeMicroBncProjete;
  franchiseTva: SeuilTvaProjete;
};

// ADR-025, correction obligatoire n° 1 : pipeline daté et tendance statistique ne sont JAMAIS
// additionnés — ce sont deux lectures alternatives du même CA futur possible, pas deux composantes
// d'un total. Aucun champ "totalProjeteCentimes" n'existe dans ce fichier, volontairement.
export type BlocPipeline = {
  montantCentimes: number | undefined; // undefined ssi aucune dateEncaissementPrevue connue dans l'année
  nombreAvecDatePrevue: number;
  consequencesFiscales: ConsequencesFiscalesProjetees | undefined; // undefined ssi montantCentimes undefined
};

export type BlocStatistique = {
  montantCentimes: number | undefined; // undefined ssi run-rate non fiable (< 6 mois garantis, correction n° 2)
  moisHistoriqueUtilises: number; // toujours renseigné, 0 si aucun mois garanti
  // Ventilation mensuelle plate (aucune saisonnalité V1) — nécessaire pour appliquer correctement un
  // changement de taux/régime/fin d'ACRE en cours d'année (correction n° 4), jamais un montant
  // annuel unique appliqué au dernier taux connu.
  ventilationMensuelle: { mois: string; montantCentimes: number }[] | undefined;
  consequencesFiscales: ConsequencesFiscalesProjetees | undefined;
};

// Temporaire, non persistée (correction n° 5) : construite à la demande depuis les paramètres de la
// requête courante, jamais écrite en base. Un total annuel unique ne peut être taxé directement que
// si le régime/la règle sont stables toute l'année — sinon chaque composante de
// consequencesFiscales retourne "ventilation_requise" explicitement plutôt qu'une répartition
// devinée (jamais un bloc `undefined` sans raison associée).
export type BlocHypothese = {
  montantAnnuelCentimes: number;
  consequencesFiscales: ConsequencesFiscalesProjetees;
};

export type ProjectionAnneeFiscale = {
  annee: number;
  pipeline: BlocPipeline;
  statistique: BlocStatistique;
  hypothese: BlocHypothese | undefined;
};
