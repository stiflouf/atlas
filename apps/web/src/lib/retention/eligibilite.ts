import { POLITIQUES_CONSERVATION_V1, type PolitiqueConservation } from "@/lib/privacy/conservation";
import type {
  ClePolitiqueConservation,
  CodeBlocageRetention,
  StatutPolitiqueRetention,
  VerdictEntiteRetention,
} from "./statutsRetention";

// RETENTION_ENGINE_FOUNDATION_DRY_RUN_V1 (ADR-066) — MOTEUR PUR.
//
// Ce fichier n'importe ni la base, ni `process.env`, ni `next/*`, et n'appelle jamais `Date.now()` :
// l'instant de référence est un paramètre OBLIGATOIRE. Ce n'est pas du purisme — une échéance de
// conservation est une comparaison entre deux dates, et une fonction qui va chercher l'une des deux
// toute seule ne peut pas être testée sur la frontière exacte, qui est précisément le seul endroit
// où elle peut se tromper.
//
// Il ne supprime rien, ne lit rien, n'écrit rien. Il répond à une question et retourne un verdict.

export const ENTITE_BON_VISITE = "bons_visite" as const;

// Vocabulaire fermé des statuts réellement acceptés par `bons_visite.statut` (CHECK
// `bons_visite_statut_check`, schema.ts). Recopié ici DÉLIBÉRÉMENT comme un vocabulaire d'entrée du
// moteur : une valeur hors de cette liste doit produire un blocage, ce qu'un `as` silencieux
// empêcherait de détecter.
const STATUTS_BON_VISITE_CONNUS = new Set(["brouillon", "signe", "annule"]);

// Données MINIMALES nécessaires au calcul. Volontairement sans nom, sans email, sans snapshot, sans
// adresse, sans clé de stockage : le moteur n'en a pas besoin, donc il ne doit pas les recevoir —
// une donnée qu'une fonction ne possède pas est une donnée qu'elle ne peut pas divulguer.
export interface CandidatBonVisiteRetention {
  readonly id: string;
  readonly workspaceId: string;
  readonly statut: string;
  readonly signeLe?: Date;
}

export interface EvaluationEntiteRetention {
  readonly policyCode: ClePolitiqueConservation;
  readonly entityType: string;
  readonly entityId: string;
  readonly statut: VerdictEntiteRetention;
  readonly eligibleAt?: Date;
  readonly blockerCode?: CodeBlocageRetention;
}

// « + 5 ans » en ARITHMÉTIQUE DE CALENDRIER, jamais en millisecondes : cinq ans ne sont pas
// 5 × 365 × 86 400 000 ms (ni 5 × 365,25), et une durée dérivée d'une année supposée se décale d'un
// jour ou deux sur l'échéance — sur une politique probatoire, décaler l'échéance, c'est supprimer
// une preuve avant terme ou la garder trop longtemps.
//
// Méthodes UTC exclusivement : le résultat ne dépend donc pas du fuseau de la machine qui exécute le
// calcul (un scan tournant à Railway en UTC et un test tournant en Europe/Paris doivent conclure la
// même chose). Cas limite assumé et déterministe : le 29 février + 5 ans donne le 1er mars, par
// débordement normal de `setUTCFullYear` — jamais une erreur silencieuse, et jamais une date
// antérieure à la précédente.
export function ajouterAnnees(instant: Date, annees: number): Date {
  const resultat = new Date(instant.getTime());
  resultat.setUTCFullYear(resultat.getUTCFullYear() + annees);
  return resultat;
}

// SIGNED_VISIT_FORM — la seule politique dont l'échéance est réellement calculable aujourd'hui
// (ADR-066 §politiques) : `bons_visite.signe_le` est NOT NULL dès que `statut = 'signe'`, garanti
// par `bons_visite_coherence_statut_check` en base, donc le déclencheur n'est pas une convention
// applicative mais un invariant SQL.
//
// FAIL-CLOSED, dans cet ordre précis :
//   statut inconnu            -> BLOCKED (on ne sait pas ce qu'est cette ligne)
//   statut connu mais ≠ signe -> OUT_OF_SCOPE (on sait, et elle n'est pas concernée)
//   signe_le absent           -> BLOCKED (incohérence avec l'invariant SQL : jamais une date 0)
//   échéance non atteinte     -> NOT_YET_ELIGIBLE
//   échéance atteinte         -> ELIGIBLE
export function evaluerBonVisiteSigne(
  candidat: CandidatBonVisiteRetention,
  instantReference: Date,
  dureeAnnees: number
): EvaluationEntiteRetention {
  const base = {
    policyCode: "SIGNED_VISIT_FORM",
    entityType: ENTITE_BON_VISITE,
    entityId: candidat.id,
  } as const;

  if (!STATUTS_BON_VISITE_CONNUS.has(candidat.statut)) {
    return { ...base, statut: "BLOCKED", blockerCode: "UNKNOWN_ENTITY_STATE" };
  }
  if (candidat.statut !== "signe") {
    return { ...base, statut: "OUT_OF_SCOPE" };
  }
  if (!candidat.signeLe || Number.isNaN(candidat.signeLe.getTime())) {
    return { ...base, statut: "BLOCKED", blockerCode: "SIGNED_AT_MISSING" };
  }

  const eligibleAt = ajouterAnnees(candidat.signeLe, dureeAnnees);
  // `>=` et non `>` : l'échéance est atteinte À l'instant de l'échéance. Une politique de cinq ans
  // qui n'échoit qu'à la première milliseconde de la sixième année serait une politique de cinq ans
  // plus un epsilon non écrit.
  const echue = instantReference.getTime() >= eligibleAt.getTime();
  return { ...base, statut: echue ? "ELIGIBLE" : "NOT_YET_ELIGIBLE", eligibleAt };
}

// Durée déclarée par la politique, lue dans `conservation.ts` plutôt que recopiée : « 5 ans » est
// une décision d'ADR-065, pas une constante de ce moteur. Un déclencheur ou une unité inattendus
// produisent `undefined`, donc un blocage en amont — jamais une durée de repli.
export function dureeAnneesPourDeclencheur(
  politique: PolitiqueConservation,
  declencheur: string
): number | undefined {
  if (politique.statut !== "DECIDEE") return undefined;
  const regle = politique.regles.find((r) => r.declencheur === declencheur);
  if (!regle || regle.duree.unite !== "ANNEES") return undefined;
  return regle.duree.valeur;
}

export interface StatutPolitiqueEvalue {
  readonly policyCode: ClePolitiqueConservation;
  readonly status: StatutPolitiqueRetention;
  readonly blockerCode?: CodeBlocageRetention;
  // Pour les politiques déjà respectées : par QUOI. Dire « déjà appliqué » sans dire par quel
  // mécanisme serait une affirmation non vérifiable.
  readonly mechanism?: string;
  // Ce qui manque encore avant qu'une suppression soit possible. Distinct de `blockerCode` : ces
  // codes n'empêchent pas de COMPTER, ils interdisent d'AGIR. Les mélanger ferait croire que la
  // politique n'est pas calculable, ou — bien pire — qu'elle est actionnable.
  readonly blocagesAvantSuppression?: readonly CodeBlocageRetention[];
}

// STATUT DE CHAQUE POLITIQUE — fonction pure, sans aucune lecture. Le `UNDECIDED` n'est pas écrit en
// dur : il est LU depuis `conservation.ts`, donc le jour où une catégorie est tranchée, ce moteur
// cesse de la déclarer indécise sans qu'on ait à le modifier ici.
export function statutPolitique(politique: PolitiqueConservation): StatutPolitiqueEvalue {
  const policyCode = politique.cle;

  if (politique.statut === "UNDECIDED") {
    return { policyCode, status: "BLOCKED_UNDECIDED_POLICY", blockerCode: "POLICY_UNDECIDED" };
  }

  switch (policyCode) {
    case "SIGNED_VISIT_FORM":
      // CALCULABLE, et strictement rien de plus. Les trois blocages ci-dessous sont l'audit
      // RETENTION_ENFORCEMENT_V1_READINESS : pas de modèle de suspension pour contentieux, pas de
      // primitive de suppression de fichier (ni le PDF, ni le PNG de signature), et un chemin de
      // suppression incomplet — `bons_visite.document_id` est en SET NULL, donc supprimer le bon
      // laisserait derrière lui la ligne `documents_bien` du PDF et son fichier, et
      // `evenements_metier.bon_visite_id` en NO ACTION bloque de toute façon la suppression dès
      // qu'un événement référence le bon.
      return {
        policyCode,
        status: "COMPUTABLE_DRY_RUN_ONLY",
        blocagesAvantSuppression: [
          "LEGAL_HOLD_MODEL_MISSING",
          "FILE_DELETE_PRIMITIVE_MISSING",
          "DELETE_PATH_MISSING",
        ],
      };

    case "PROSPECT_MARKETING":
      return { policyCode, status: "BLOCKED_MISSING_TRIGGER", blockerCode: "LAST_INBOUND_CONTACT_AT_MISSING" };

    case "CUSTOMER_MARKETING":
      return { policyCode, status: "BLOCKED_MISSING_TRIGGER", blockerCode: "RELATIONSHIP_END_AT_MISSING" };

    case "SESSION":
      return {
        policyCode,
        status: "ALREADY_ENFORCED",
        mechanism: "Cookie de session scellé (iron-session), ttl 7 jours — aucune table de session.",
      };

    case "OIDC_STATE":
      return {
        policyCode,
        status: "ALREADY_ENFORCED",
        mechanism: "Cookie d'état, maxAge 600 s, consommé à usage unique avant validation.",
      };

    case "GOOGLE_CONNECTION":
      // PARTIEL et non ALREADY_ENFORCED : la déconnexion révoque puis supprime la ligne, mais une
      // connexion dont le refresh token chiffré est devenu illisible est traitée comme « non
      // connectée » et CONSERVÉE en base. Chantier séparé — pas de purge improvisée ici.
      return {
        policyCode,
        status: "PARTIAL_EXISTING_RUNTIME",
        mechanism:
          "Révocation côté Google puis suppression de la ligne à la déconnexion. Écart connu : une connexion dont le refresh token chiffré est illisible reste en base.",
      };

    default:
      // Dérive : une politique décidée est apparue dans conservation.ts sans être branchée ici.
      // Fail-closed — bloquée et nommée, jamais ignorée.
      return { policyCode, status: "BLOCKED_MISSING_TRIGGER", blockerCode: "UNKNOWN_POLICY" };
  }
}

export function politiquesARetenir(): readonly PolitiqueConservation[] {
  return POLITIQUES_CONSERVATION_V1;
}

export interface AgregatPolitiqueRetention {
  readonly eligibleCount: number;
  readonly blockedCount: number;
  readonly outOfScopeCount: number;
  readonly notYetEligibleCount: number;
  readonly oldestEligibleAt?: Date;
  readonly newestEligibleAt?: Date;
}

// AGRÉGATION — pure, et c'est elle qui fait tomber les identifiants. Elle reçoit des évaluations
// portant un `entityId` (nécessaire en interne pour composer et dédupliquer) et ne rend que des
// compteurs et deux bornes de dates. Aucun identifiant ne franchit cette frontière, ce qui rend la
// réponse du dry-run non personnelle PAR CONSTRUCTION et non par filtrage de dernière minute.
export function agregerEvaluations(evaluations: readonly EvaluationEntiteRetention[]): AgregatPolitiqueRetention {
  let eligibleCount = 0;
  let blockedCount = 0;
  let outOfScopeCount = 0;
  let notYetEligibleCount = 0;
  let oldestEligibleAt: Date | undefined;
  let newestEligibleAt: Date | undefined;

  for (const evaluation of evaluations) {
    switch (evaluation.statut) {
      case "ELIGIBLE": {
        eligibleCount += 1;
        const echeance = evaluation.eligibleAt;
        if (!echeance) break;
        if (!oldestEligibleAt || echeance.getTime() < oldestEligibleAt.getTime()) oldestEligibleAt = echeance;
        if (!newestEligibleAt || echeance.getTime() > newestEligibleAt.getTime()) newestEligibleAt = echeance;
        break;
      }
      case "BLOCKED":
        blockedCount += 1;
        break;
      case "OUT_OF_SCOPE":
        outOfScopeCount += 1;
        break;
      case "NOT_YET_ELIGIBLE":
        notYetEligibleCount += 1;
        break;
    }
  }

  return { eligibleCount, blockedCount, outOfScopeCount, notYetEligibleCount, oldestEligibleAt, newestEligibleAt };
}
