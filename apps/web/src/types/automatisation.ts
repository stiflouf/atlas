import type { CibleTache, PrioriteTache, TypeTache } from "./tache";

// Événement métier atomique (ADR-032) — distinct d'une alerte (ADR-026, un jugement dérivé sur
// l'état courant, jamais persisté) et d'une tâche (ADR-028, une action à faire). Décrit
// uniquement "ceci est réellement survenu à cet instant", jamais une décision.
export type TypeEvenementMetier = "visite_realisee" | "rdv_estimation_realise" | "mandat_signe" | "compromis_signe";

export type EvenementMetier = {
  id: string;
  typeEvenement: TypeEvenementMetier;
  compteRenduVisiteId?: string;
  prospectVendeurId?: string;
  compromisId?: string;
  survenuLe: string;
};

// Identifiants stables du catalogue de règles (src/lib/automatisations/catalogueRegles.ts).
export type CodeRegleAutomatisation =
  | "suivi_apres_visite"
  | "suivi_apres_rdv_estimation"
  | "preparation_apres_mandat"
  | "preparation_dossier_notaire_apres_compromis";

export const CODES_REGLE_AUTOMATISATION: CodeRegleAutomatisation[] = [
  "suivi_apres_visite",
  "suivi_apres_rdv_estimation",
  "preparation_apres_mandat",
  "preparation_dossier_notaire_apres_compromis",
];

// Snapshot d'exécution d'une règle pour un événement précis. Trois états dérivés, jamais un
// troisième "incertain" (créer une tâche est une écriture Postgres locale, sans ambiguïté réseau
// contrairement à un envoi Gmail, ADR-031-bis) — `a_traiter` est l'état normal juste après le
// COMMIT de la transaction métier, avant le traitement synchrone qui suit immédiatement, ET l'état
// laissé si le process s'arrête entre les deux : jamais perdu, jamais confondu avec "traité".
export type EtatExecutionAutomatisation = "a_traiter" | "reussie" | "echouee";

export type ExecutionAutomatisation = {
  id: string;
  regleCode: CodeRegleAutomatisation;
  evenementId: string;
  tacheId?: string;
  demarreeLe: string;
  reussieLe?: string;
  echoueeLe?: string;
  erreurTechnique?: string;
};

export function deriverEtatExecutionAutomatisation(execution: ExecutionAutomatisation): EtatExecutionAutomatisation {
  if (execution.reussieLe) return "reussie";
  if (execution.echoueeLe) return "echouee";
  return "a_traiter";
}

export type ConfigurationAutomatisation = {
  regleCode: CodeRegleAutomatisation;
  active: boolean;
  modifieLe: string;
};

// Ce qu'une règle peut produire — structurellement sans `echeance` ni `origine`/`origineCode`
// (posés uniquement par le moteur, jamais par une règle) : aucune règle ne peut inventer un délai
// arbitraire ni usurper l'identité d'une autre règle (ADR-032, point 9).
export type ChampsTacheAutomatique = {
  titre: string;
  contexte?: string;
  type: TypeTache;
  priorite: PrioriteTache;
  cible: CibleTache;
};
