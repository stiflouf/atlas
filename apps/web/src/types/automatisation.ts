import type { CibleTache, PrioriteTache, TypeTache } from "./tache";

// Événement métier atomique (ADR-032) — distinct d'une alerte (ADR-026, un jugement dérivé sur
// l'état courant, jamais persisté) et d'une tâche (ADR-028, une action à faire). Décrit
// uniquement "ceci est réellement survenu à cet instant", jamais une décision.
//
// 'inactivite_prospect_vendeur' (ADR-033) est le premier type CYCLIQUE (peut survenir plusieurs
// fois pour le même prospectVendeurId au fil du temps) — contrairement aux quatre premiers, tous
// ponctuels et non répétables pour une même cible. C'est pourquoi il porte `ancreCycle` (voir
// ci-dessous) et un index d'idempotence dédié (db/schema.ts), distinct de celui des types ponctuels.
export type TypeEvenementMetier =
  | "visite_realisee"
  | "rdv_estimation_realise"
  | "mandat_signe"
  | "compromis_signe"
  | "inactivite_prospect_vendeur";

export type EvenementMetier = {
  id: string;
  typeEvenement: TypeEvenementMetier;
  compteRenduVisiteId?: string;
  prospectVendeurId?: string;
  compromisId?: string;
  // Ancre du cycle temporel (ADR-033) — le dernierContactLe (ou creeLe si aucun contact n'a
  // jamais eu lieu) qui a servi de base au calcul du seuil franchi. Distincte de `survenuLe` : ici
  // le moment où le FAIT a été établi (le dernier contact réel), pas le moment où Atlas l'a
  // détecté. `undefined` pour les quatre types ponctuels d'ADR-032.
  ancreCycle?: string;
  survenuLe: string;
};

// Identifiants stables du catalogue de règles (src/lib/automatisations/catalogueRegles.ts).
export type CodeRegleAutomatisation =
  | "suivi_apres_visite"
  | "suivi_apres_rdv_estimation"
  | "preparation_apres_mandat"
  | "preparation_dossier_notaire_apres_compromis"
  | "inactivite_prospect_vendeur";

export const CODES_REGLE_AUTOMATISATION: CodeRegleAutomatisation[] = [
  "suivi_apres_visite",
  "suivi_apres_rdv_estimation",
  "preparation_apres_mandat",
  "preparation_dossier_notaire_apres_compromis",
  "inactivite_prospect_vendeur",
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
  // Seuil produit explicite (ADR-033, jamais une constante cachée) — n'a de sens que pour
  // 'inactivite_prospect_vendeur' aujourd'hui, `undefined` pour les autres règles. `undefined`
  // interdit l'activation de la règle (validée côté Server Action) : jamais de valeur implicite.
  seuilJoursInactivite?: number;
  modifieLe: string;
};

// Journal technique d'un passage du scanner temporel (ADR-033) — jamais de donnée personnelle
// (aucun identifiant de prospect), seulement des compteurs agrégés. Trois états dérivés :
// `termineLe` absent après un crash reste honnêtement visible comme "en_cours" (jamais confondu
// avec un run réellement terminé) — voir runScanAutomatisationRepository.ts pour l'écriture à
// mutation contrôlée (une ligne, deux écritures : démarrage puis complétion).
export type EtatRunScanAutomatisation = "en_cours" | "termine" | "echoue";

export type RunScanAutomatisation = {
  id: string;
  regleCode: CodeRegleAutomatisation;
  demarreLe: string;
  termineLe?: string;
  nombreCandidats?: number;
  nombreOccurrencesCreees?: number;
  erreurTechnique?: string;
};

export function deriverEtatRunScanAutomatisation(run: RunScanAutomatisation): EtatRunScanAutomatisation {
  if (run.erreurTechnique) return "echoue";
  if (run.termineLe) return "termine";
  return "en_cours";
}

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
