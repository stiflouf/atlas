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
  // LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — champ OBLIGATOIRE, et c'est la première des deux gardes
  // fail-closed de l'intégration : il n'est pas optionnel, donc un objet littéral qui l'omettrait ne
  // compile pas. Un `boolean | undefined` aurait fait d'un oubli de câblage une ligne ÉLIGIBLE,
  // c'est-à-dire exactement la panne qu'un legal hold doit rendre impossible.
  //
  // Le type ne suffit pourtant pas à lui seul, et il faut le dire : un appelant qui construit le
  // candidat en étalant un `Partial<CandidatBonVisiteRetention>` échappe à la vérification (c'est
  // l'idiome des fixtures de test, qui posent donc le champ explicitement). La garde qui tient
  // vraiment est la seconde : le seul producteur de production est
  // `listerCandidatsBonVisitePourRetention`, qui le renseigne depuis la base, et dont l'échec de
  // lecture remonte au lieu de produire « non protégé ».
  //
  // Le moteur reçoit un booléen, jamais le hold lui-même : il n'a aucun usage du motif, de l'auteur
  // ni des dates de l'acte, et une donnée qu'une fonction ne possède pas est une donnée qu'elle ne
  // peut pas divulguer.
  readonly sousLegalHoldActif: boolean;
  // RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — champ OBLIGATOIRE, même raison que ci-dessus : un
  // objet littéral qui l'omettrait ne compile pas.
  //
  // Il est purement INFORMATIF : être en quarantaine ne change AUCUN verdict. Une ligne en
  // quarantaine reste `ELIGIBLE` au sens de la politique — la quarantaine est l'étape SUIVANTE, pas
  // un blocage. Le confondre avec un blocage masquerait les lignes déjà prises en charge dans le
  // même compteur que celles qui ne le sont pas.
  readonly enQuarantaineActive: boolean;
}

export interface EvaluationEntiteRetention {
  readonly policyCode: ClePolitiqueConservation;
  readonly entityType: string;
  readonly entityId: string;
  readonly statut: VerdictEntiteRetention;
  readonly eligibleAt?: Date;
  readonly blockerCode?: CodeBlocageRetention;
  // ADR-069 — repris du candidat et transporté tel quel jusqu'à l'agrégation, qui en fait un
  // compteur. Aucune branche de décision ne le lit : la quarantaine n'influence aucun verdict.
  readonly enQuarantaineActive: boolean;
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
//   échéance atteinte         -> ELIGIBLE, SAUF legal hold actif -> BLOCKED_BY_LEGAL_HOLD (ADR-068)
//
// ORDRE du legal hold, explicite parce qu'il est le seul point discutable : le hold est appliqué EN
// DERNIER, sur le seul verdict qui autoriserait un jour une suppression. Les trois autres sont déjà
// non supprimables et le dire deux fois les rendrait moins lisibles : `OUT_OF_SCOPE` signifie que la
// ligne ne relève pas de la politique (un hold n'y change rien), `NOT_YET_ELIGIBLE` que l'échéance
// n'est pas atteinte, et `BLOCKED` que l'état de la ligne est incompréhensible — un cas où « on ne
// sait pas » doit rester le verdict le plus fort, jamais être adouci en « simplement protégé ».
export function evaluerBonVisiteSigne(
  candidat: CandidatBonVisiteRetention,
  instantReference: Date,
  dureeAnnees: number
): EvaluationEntiteRetention {
  const base = {
    policyCode: "SIGNED_VISIT_FORM",
    entityType: ENTITE_BON_VISITE,
    entityId: candidat.id,
    enQuarantaineActive: candidat.enQuarantaineActive,
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
  if (!echue) return { ...base, statut: "NOT_YET_ELIGIBLE", eligibleAt };
  if (candidat.sousLegalHoldActif) {
    // `eligibleAt` est CONSERVÉ : l'échéance est un fait, et le hold ne l'annule pas — il interdit
    // d'agir dessus. L'effacer rendrait impossible de savoir, à la levée, depuis quand la pièce
    // était échue.
    return { ...base, statut: "BLOCKED_BY_LEGAL_HOLD", eligibleAt, blockerCode: "ACTIVE_LEGAL_HOLD" };
  }
  return { ...base, statut: "ELIGIBLE", eligibleAt };
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
      // CALCULABLE, et strictement rien de plus. Les blocages ci-dessous sont l'audit
      // RETENTION_ENFORCEMENT_V1_READINESS : la primitive de suppression de fichier n'est branchée
      // sur aucun chemin métier (ni le PDF, ni le PNG de signature), et le chemin de
      // suppression reste incomplet — `bons_visite.document_id` est en SET NULL, donc supprimer le bon
      // laisserait derrière lui la ligne `documents_bien` du PDF et son fichier, et
      // `evenements_metier.bon_visite_id` en NO ACTION bloque de toute façon la suppression dès
      // qu'un événement référence le bon.
      return {
        policyCode,
        status: "COMPUTABLE_DRY_RUN_ONLY",
        // ADR-068 a retiré `LEGAL_HOLD_MODEL_MISSING` de cette liste, et UNIQUEMENT celui-là : le
        // modèle de suspension existe désormais et le moteur le consulte réellement, donc l'y laisser
        // serait faux. Les deux autres restent vrais et aucun n'est touché par ce lot —
        // `FILE_DELETE_PRIMITIVE_MISSING` relève du câblage de la primitive d'ADR-067, qui n'est
        // branchée sur aucun chemin métier.
        //
        // Retirer un blocage n'autorise RIEN : chacun suffit seul à interdire d'agir, et
        // `APPLY_SUPPORTED` reste false.
        blocagesAvantSuppression: [
          "FILE_DELETE_PRIMITIVE_MISSING",
          "DELETE_PATH_MISSING",
          // ADR-069 — ajouté par le lot quarantaine : le modèle d'état existe, sa DURÉE n'est pas
          // décidée. Un blocage de plus, jamais un de moins.
          "QUARANTINE_POLICY_MISSING",
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
  // ADR-068 — compteur PROPRE, jamais fondu dans `blockedCount`. Une protection délibérée et une
  // incohérence de données ne se lisent pas de la même façon : la première se lève par une décision
  // documentée, la seconde se corrige. Les additionner rendrait le journal muet sur les deux.
  readonly legalHoldCount: number;
  // ADR-069 — lignes déjà prises en charge par une quarantaine active. Compteur INFORMATIF : ces
  // lignes sont aussi comptées dans `eligibleCount` (ou `legalHoldCount` si un hold est apparu
  // depuis), car la quarantaine n'est pas un verdict d'éligibilité mais l'étape suivante.
  readonly quarantineCount: number;
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
  let legalHoldCount = 0;
  let quarantineCount = 0;
  let oldestEligibleAt: Date | undefined;
  let newestEligibleAt: Date | undefined;

  for (const evaluation of evaluations) {
    // Compté HORS du switch, et c'est voulu : une ligne en quarantaine peut être ÉLIGIBLE ou
    // BLOCKED_BY_LEGAL_HOLD (un hold posé après l'entrée), et le compteur doit la voir dans les deux
    // cas. L'imbriquer dans une branche ferait disparaître du décompte précisément les lignes dont
    // la situation est la plus délicate.
    if (evaluation.enQuarantaineActive) quarantineCount += 1;

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
      case "BLOCKED_BY_LEGAL_HOLD":
        // Compté à part, et SANS alimenter les bornes de dates : `oldestEligibleAt` /
        // `newestEligibleAt` décrivent l'étendue de ce qui serait actionnable, et une ligne protégée
        // ne l'est pas. L'y inclure ferait croire à une fenêtre de purge plus large qu'elle n'est.
        legalHoldCount += 1;
        break;
    }
  }

  return {
    eligibleCount,
    blockedCount,
    outOfScopeCount,
    notYetEligibleCount,
    legalHoldCount,
    quarantineCount,
    oldestEligibleAt,
    newestEligibleAt,
  };
}
