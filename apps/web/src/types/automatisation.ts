import type { CibleTache, PrioriteTache, TypeTache } from "./tache";

// Événement métier atomique (ADR-032) — distinct d'une alerte (ADR-026, un jugement dérivé sur
// l'état courant, jamais persisté) et d'une tâche (ADR-028, une action à faire). Décrit
// uniquement "ceci est réellement survenu à cet instant", jamais une décision.
//
// 'inactivite_prospect_vendeur' (ADR-033) est le premier type CYCLIQUE (peut survenir plusieurs
// fois pour le même prospectVendeurId au fil du temps) — contrairement aux quatre premiers, tous
// ponctuels et non répétables pour une même cible. C'est pourquoi il porte `ancreCycle` (voir
// ci-dessous) et un index d'idempotence dédié (db/schema.ts), distinct de celui des types ponctuels.
//
// 'compatibilite_bien_acquereur_devenue_compatible' (ADR-036) est le second type CYCLIQUE — une
// paire (bien, acquéreur) peut redevenir compatible après avoir cessé de l'être. Porte
// `bienId`/`acquereurId`/`cycleCompatibilite` au lieu de `ancreCycle` : aucun ancrage temporel
// métier externe n'existe ici (contrairement au dernier contact d'un prospect), l'idempotence de
// cycle repose donc sur un compteur entier plutôt qu'un timestamp.
//
// ADR-061 — types OFFRE (ponctuels : chaque transition survient au plus une fois par offre, le
// cycle de vie étant irréversible) et fin de vie du COMPROMIS. Émis dans la transaction du writer
// qui pose le fait.
//
// AUTOMATION_ENGINE_GENERALIZATION_V1 — trois types TEMPORELS PONCTUELS supplémentaires, émis par
// un scanner (jamais par un writer métier) quand un seuil configuré est franchi : chaque type
// survient au plus une fois par cible (mandat/offre), comme les types Offre ci-dessus — aucun
// `ancreCycle` : contrairement à `inactivite_prospect_vendeur`, il n'existe pas de second passage
// légitime pour la MÊME cible (un mandat renouvelé change d'identité — `mandatId` — ; une offre
// décidée sort définitivement du champ de la règle qui l'a vue "sans décision"/"acceptée").
// `offre_sans_decision`/`offre_acceptee_sans_compromis` portent `offreId`, déjà cible d'ADR-061 :
// aucun nouveau champ, l'index d'idempotence générique `evenements_metier_offre_unique` suffit.
export type TypeEvenementMetier =
  | "visite_realisee"
  | "rdv_estimation_realise"
  | "mandat_signe"
  | "compromis_signe"
  | "inactivite_prospect_vendeur"
  | "compatibilite_bien_acquereur_devenue_compatible"
  | "offre_recue"
  | "offre_acceptee"
  | "offre_refusee"
  | "offre_retiree"
  | "offre_caduque"
  | "compromis_realise"
  | "compromis_annule"
  | "mandat_expire_bientot"
  | "offre_sans_decision"
  | "offre_acceptee_sans_compromis"
  // VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — ponctuel, cible `visiteId` (nouvelle colonne). Jamais
  // `compteRenduVisiteId` : `visite_realisee` garde son contrat exact (ADR-041 §5), inchangé.
  | "visite_annulee";

export type EvenementMetier = {
  id: string;
  // ADR-054 — périmètre propriétaire de l'événement. Exposé dans le type MÉTIER parce qu'un
  // consommateur en a un besoin réel et vérifiable : le moteur d'automatisations crée une tâche à
  // partir de cet événement et doit la ranger dans le MÊME workspace, sans jamais deviner ni
  // dépendre d'un contexte ambiant. Ce n'est pas une donnée d'affichage.
  workspaceId: string;
  typeEvenement: TypeEvenementMetier;
  compteRenduVisiteId?: string;
  prospectVendeurId?: string;
  compromisId?: string;
  // ADR-061 — cible des types `offre_*` ; le bien se dérive par l'offre, jamais dupliqué ici.
  // Réutilisée telle quelle par `offre_sans_decision`/`offre_acceptee_sans_compromis`
  // (AUTOMATION_ENGINE_GENERALIZATION_V1).
  offreId?: string;
  // AUTOMATION_ENGINE_GENERALIZATION_V1 — cible de `mandat_expire_bientot`. Le bien se dérive par
  // le mandat (`mandat.bienId`), jamais dupliqué ici — même raisonnement que `offreId`.
  mandatId?: string;
  // VISIT_NATIVE_LIFECYCLE_V1 (ADR-063) — cible de `visite_annulee` uniquement. `visite_realisee`
  // continue de cibler `compteRenduVisiteId` ci-dessus, contrat inchangé.
  visiteId?: string;
  // Ancre du cycle temporel (ADR-033) — le dernierContactLe (ou creeLe si aucun contact n'a
  // jamais eu lieu) qui a servi de base au calcul du seuil franchi. Distincte de `survenuLe` : ici
  // le moment où le FAIT a été établi (le dernier contact réel), pas le moment où Atlas l'a
  // détecté. `undefined` pour les quatre types ponctuels d'ADR-032.
  ancreCycle?: string;
  // Cible de compatibilité (ADR-036) — toujours posés ENSEMBLE, jamais l'un sans l'autre. Aucune
  // autre donnée du bien/de l'acquéreur (nom, budget, critères...) : ces identifiants suffisent à
  // relire les entités au moment où elles sont réellement nécessaires (minimisation).
  bienId?: string;
  acquereurId?: string;
  // Numéro de cycle de compatibilité (ADR-036) — porte la même fonction d'idempotence que
  // `ancreCycle`, sous forme de compteur plutôt que de timestamp. `undefined` pour tous les autres
  // types d'événement.
  cycleCompatibilite?: number;
  survenuLe: string;
};

// Identifiants stables du catalogue de règles (src/lib/automatisations/catalogueRegles.ts).
export type CodeRegleAutomatisation =
  | "suivi_apres_visite"
  | "suivi_apres_rdv_estimation"
  | "preparation_apres_mandat"
  | "preparation_dossier_notaire_apres_compromis"
  | "inactivite_prospect_vendeur"
  | "nouveau_match_bien_acquereur"
  | "retour_vendeur_apres_visite"
  | "mandat_expire_bientot"
  | "offre_sans_decision"
  | "offre_acceptee_sans_compromis";

export const CODES_REGLE_AUTOMATISATION: CodeRegleAutomatisation[] = [
  "suivi_apres_visite",
  "suivi_apres_rdv_estimation",
  "preparation_apres_mandat",
  "preparation_dossier_notaire_apres_compromis",
  "inactivite_prospect_vendeur",
  "nouveau_match_bien_acquereur",
  "retour_vendeur_apres_visite",
  "mandat_expire_bientot",
  "offre_sans_decision",
  "offre_acceptee_sans_compromis",
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
  // ADR-038 — observabilité/plafond de la reprise après crash, jamais la source de la garantie
  // d'idempotence (voir schema.ts). `nombreTentatives` reste à 0/`derniereTentativeLe` undefined
  // pour toute exécution résolue par le chemin synchrone normal, sans jamais passer par la reprise.
  nombreTentatives: number;
  derniereTentativeLe?: string;
};

export function deriverEtatExecutionAutomatisation(execution: ExecutionAutomatisation): EtatExecutionAutomatisation {
  if (execution.reussieLe) return "reussie";
  if (execution.echoueeLe) return "echouee";
  return "a_traiter";
}

export type ConfigurationAutomatisation = {
  regleCode: CodeRegleAutomatisation;
  active: boolean;
  // Seuil produit explicite (ADR-033), jamais une constante cachée — GÉNÉRALISÉ par
  // AUTOMATION_ENGINE_GENERALIZATION_V1 (colonne db renommée `seuil_jours`, plus de nom lié à une
  // seule règle) : n'a de sens que pour les règles temporelles à seuil
  // (`inactivite_prospect_vendeur`, `mandat_expire_bientot`, `offre_sans_decision`,
  // `offre_acceptee_sans_compromis`), `undefined` pour les autres règles ET par défaut. `undefined`
  // interdit l'activation de la règle (validée côté Server Action) : jamais de valeur implicite.
  seuilJours?: number;
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
