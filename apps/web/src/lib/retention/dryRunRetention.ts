import { listerTousLesWorkspaceIds } from "@/lib/workspaceRepository";
import {
  agregerEvaluations,
  dureeAnneesPourDeclencheur,
  evaluerBonVisiteSigne,
  politiquesARetenir,
  statutPolitique,
  type EvaluationEntiteRetention,
} from "./eligibilite";
import {
  listerCandidatsBonVisitePourRetention,
  demarrerRunRetention,
  terminerRunRetention,
} from "./retentionRepository";
import {
  APPLY_SUPPORTED,
  MODE_RETENTION_V1,
  type ClePolitiqueConservation,
  type CodeBlocageRetention,
  type StatutPolitiqueRetention,
} from "./statutsRetention";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — service applicatif du dry-run.
//
// CE SERVICE NE SUPPRIME RIEN, et ce n'est pas une promesse de commentaire : il n'importe aucune
// primitive de suppression, aucun accès fichier, et son unique dépendance en écriture est le journal
// de run de rétention. `mode: "apply"` est refusé ici, AVANT toute lecture — le refus est applicatif
// et non seulement routier, pour qu'un futur appelant interne (script, autre service) ne puisse pas
// contourner la garde en évitant la route HTTP.

export class ErreurModeRetentionNonSupporte extends Error {
  constructor(mode: string) {
    super(
      `Mode de rétention "${mode}" non supporté : seul "${MODE_RETENTION_V1}" existe. Aucune purge n'est livrée (ADR-066).`
    );
    this.name = "ErreurModeRetentionNonSupporte";
  }
}

// RÉSULTAT PUBLIC — agrégé, jamais nominatif. Aucun `entityId`, aucun `contactId`, aucun
// `bonVisiteId`, aucun nom, email, téléphone, adresse ni texte libre : le moteur pur fait tomber les
// identifiants à l'agrégation (voir `agregerEvaluations`), ce qui rend cette propriété structurelle
// plutôt que déclarative.
export interface ResultatPolitiqueDryRun {
  readonly policyCode: ClePolitiqueConservation;
  readonly status: StatutPolitiqueRetention;
  readonly eligibleCount: number;
  readonly blockedCount: number;
  readonly notYetEligibleCount: number;
  readonly outOfScopeCount: number;
  readonly oldestEligibleAt?: string;
  readonly newestEligibleAt?: string;
  readonly blockerCode?: CodeBlocageRetention;
  readonly mechanism?: string;
  readonly blocagesAvantSuppression?: readonly CodeBlocageRetention[];
  // Présent = les compteurs de CETTE politique ne sont pas probants. Dire « 0 éligible » après une
  // erreur de lecture serait indistinguable de « rien à faire », et c'est exactement la confusion
  // qui ferait croire un jour qu'une purge n'avait rien à purger.
  readonly erreurTechnique?: string;
}

export interface ResultatDryRunRetention {
  readonly mode: typeof MODE_RETENTION_V1;
  readonly workspaceId: string;
  readonly runId: string;
  readonly politiques: readonly ResultatPolitiqueDryRun[];
}

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

function estBloquee(statut: StatutPolitiqueRetention): boolean {
  return statut.startsWith("BLOCKED_");
}

const AUCUN_COMPTEUR = {
  eligibleCount: 0,
  blockedCount: 0,
  notYetEligibleCount: 0,
  outOfScopeCount: 0,
} as const;

// Évaluation d'UNE politique pour UN workspace. Les politiques bloquées ou déjà appliquées ne
// déclenchent AUCUNE lecture : charger un dataset pour conclure « bloqué » serait lire des données
// personnelles sans en avoir l'usage, ce qui est précisément ce que ce chantier doit éviter de
// normaliser.
async function evaluerPolitiquePourWorkspace(
  politique: ReturnType<typeof politiquesARetenir>[number],
  workspaceId: string,
  maintenant: Date
): Promise<ResultatPolitiqueDryRun> {
  const evalue = statutPolitique(politique);

  if (evalue.status !== "COMPUTABLE_DRY_RUN_ONLY") {
    return { ...evalue, ...AUCUN_COMPTEUR };
  }

  if (evalue.policyCode !== "SIGNED_VISIT_FORM") {
    // Une politique calculable sans évaluateur branché : fail-closed, jamais un comptage à zéro
    // présenté comme un résultat.
    return {
      ...evalue,
      ...AUCUN_COMPTEUR,
      status: "BLOCKED_MISSING_TRIGGER",
      blockerCode: "UNKNOWN_POLICY",
    };
  }

  // La durée vient de la politique (ADR-065), jamais d'une constante locale. Son absence est un
  // blocage, pas un repli sur une valeur plausible.
  const dureeAnnees = dureeAnneesPourDeclencheur(politique, "SIGNED_AT");
  if (dureeAnnees === undefined) {
    return {
      ...evalue,
      ...AUCUN_COMPTEUR,
      status: "BLOCKED_MISSING_TRIGGER",
      blockerCode: "UNKNOWN_POLICY",
    };
  }

  const candidats = await listerCandidatsBonVisitePourRetention(workspaceId);
  const evaluations: EvaluationEntiteRetention[] = candidats.map((candidat) =>
    evaluerBonVisiteSigne(candidat, maintenant, dureeAnnees)
  );
  const agregat = agregerEvaluations(evaluations);

  return {
    ...evalue,
    eligibleCount: agregat.eligibleCount,
    blockedCount: agregat.blockedCount,
    notYetEligibleCount: agregat.notYetEligibleCount,
    outOfScopeCount: agregat.outOfScopeCount,
    oldestEligibleAt: agregat.oldestEligibleAt?.toISOString(),
    newestEligibleAt: agregat.newestEligibleAt?.toISOString(),
  };
}

// Point d'entrée unique du dry-run. Une passe PAR WORKSPACE (ADR-054 / WORKSPACE_SCOPING_V2B5),
// politiques à l'intérieur — même déroulé que `executerScanTemporelComplet`, y compris l'isolation
// par try/catch : l'échec d'une politique n'empêche jamais les autres d'être évaluées, et il est
// rapporté dans le résultat de CETTE politique plutôt que masqué.
//
// `maintenant` est injecté et par défaut `new Date()` ici, au point d'entrée IO — jamais dans le
// moteur pur, dont aucune fonction ne lit l'horloge.
export async function executerDryRunRetention(options?: {
  mode?: string;
  maintenant?: Date;
}): Promise<ResultatDryRunRetention[]> {
  const mode = options?.mode ?? MODE_RETENTION_V1;
  if (mode !== MODE_RETENTION_V1) {
    // Garde unique et fail-closed : tout ce qui n'est pas exactement "dry-run" est refusé, y
    // compris "apply". APPLY_SUPPORTED reste false tant qu'aucun chemin de suppression sûr n'existe.
    throw new ErreurModeRetentionNonSupporte(mode);
  }

  const maintenant = options?.maintenant ?? new Date();
  const resultats: ResultatDryRunRetention[] = [];

  for (const workspaceId of await listerTousLesWorkspaceIds()) {
    const runId = await demarrerRunRetention(workspaceId, MODE_RETENTION_V1);
    const politiques: ResultatPolitiqueDryRun[] = [];

    for (const politique of politiquesARetenir()) {
      try {
        politiques.push(await evaluerPolitiquePourWorkspace(politique, workspaceId, maintenant));
      } catch (erreur) {
        politiques.push({
          policyCode: politique.cle,
          status: "BLOCKED_MISSING_TRIGGER",
          blockerCode: "REPOSITORY_ERROR",
          ...AUCUN_COMPTEUR,
          erreurTechnique: categoriserErreur(erreur),
        });
      }
    }

    const nombreEligibles = politiques.reduce((total, p) => total + p.eligibleCount, 0);
    const nombreBloquees = politiques.filter((p) => estBloquee(p.status)).length;
    const erreurs = politiques.filter((p) => p.erreurTechnique).map((p) => p.policyCode);

    await terminerRunRetention(runId, {
      nombrePolitiques: politiques.length,
      nombreEligibles,
      nombreBloquees,
      // Le journal dit QUELLES politiques ont échoué, par leur code — jamais le détail d'une donnée.
      erreurTechnique: erreurs.length > 0 ? `politiques_en_erreur: ${erreurs.join(",")}` : undefined,
    });

    resultats.push({ mode: MODE_RETENTION_V1, workspaceId, runId, politiques });
  }

  return resultats;
}

export { APPLY_SUPPORTED };
