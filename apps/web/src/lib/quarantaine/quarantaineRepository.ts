import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { biens, bonsVisite, retentionQuarantines, visites } from "@/db/schema";
import { listerCiblesSousLegalHoldActif } from "@/lib/legalHold/legalHoldRepository";
import { POLITIQUES_CONSERVATION_V1 } from "@/lib/privacy/conservation";
import { dureeAnneesPourDeclencheur, evaluerBonVisiteSigne } from "@/lib/retention/eligibilite";
import {
  validerCauseLevee,
  validerEcheanceRevalidation,
  validerIdentiteSubQuarantaine,
  validerMotifQuarantaine,
  validerPolitiqueQuarantaine,
  validerTypeCibleQuarantaine,
  validerWorkspaceIdQuarantaine,
  revaliderQuarantaine as revaliderQuarantainePure,
  type Quarantaine,
} from "./quarantaine";
import type {
  CauseLeveeQuarantaine,
  PolitiqueQuarantaine,
  TypeCibleQuarantaine,
  VerdictRevalidationQuarantaine,
} from "./statutsQuarantaine";

// RETENTION_QUARANTINE_FOUNDATION_V1 (ADR-069) — seul point de ce chantier qui parle à Postgres
// (ADR-007).
//
// CE MODULE NE SUPPRIME RIEN. Il INSÈRE une quarantaine, il UPDATE sa levée, il LIT. Aucun
// `.delete()`, aucun DELETE SQL, aucun accès au système de fichiers, aucun appel à
// `supprimerFichierStocke`, aucune écriture sur une table métier, aucune écriture dans le registre
// des legal holds. Lever une quarantaine ne supprime rien et n'autorise rien ; atteindre une
// échéance non plus.
//
// IMMUTABILITÉ DU REGISTRE : la seule mutation autorisée est la transition « active -> levée », et
// elle n'écrase aucune information d'entrée. Aucune fonction ne permet de modifier `motif`,
// `entre_le`, `entre_par_identite_sub` ni `revalidation_due_le` après coup — rallonger une échéance
// en silence reviendrait à réécrire la chronologie d'une décision de rétention.
//
// LEGAL HOLD : ce module est LECTEUR SEUL du registre des holds. Il n'importe que
// `listerCiblesSousLegalHoldActif`, et aucun chemin ici ne pose ni ne lève un hold.
//
// WORKSPACE : `retention_quarantines` est une RACINE (ADR-054 §7). Toute fonction reçoit le
// périmètre en PARAMÈTRE — jamais lu depuis la session ici — et le place dans le `WHERE`, y compris
// pour l'UPDATE de levée. Une quarantaine d'un autre workspace est INTROUVABLE, et non « visible
// mais refusée » : même patron que `legalHoldRepository` et `bonVisiteRepository`.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODE_VIOLATION_UNICITE = "23505";
// NOMMÉE, et pas seulement reconnue par son code : un `23505` quelconque peut venir d'une tout autre
// contrainte, et le traiter comme « cette quarantaine existe déjà » masquerait un défaut réel
// derrière un résultat rassurant.
const CONTRAINTE_QUARANTAINE_ACTIVE_UNIQUE = "retention_quarantines_cible_active_unique";

// Drizzle ENVELOPPE l'erreur du driver : le code et le nom de contrainte sont sur la cause, pas sur
// l'erreur reçue. La chaîne est donc parcourue.
function estViolationQuarantaineActiveUnique(erreur: unknown): boolean {
  let courante: unknown = erreur;
  for (let profondeur = 0; courante !== null && courante !== undefined && profondeur < 5; profondeur += 1) {
    const candidate = courante as { code?: string; constraint_name?: string; cause?: unknown };
    if (candidate.code === CODE_VIOLATION_UNICITE && candidate.constraint_name === CONTRAINTE_QUARANTAINE_ACTIVE_UNIQUE) {
      return true;
    }
    courante = candidate.cause;
  }
  return false;
}

export interface EntreeCreationQuarantaine {
  readonly policyCode: PolitiqueQuarantaine;
  readonly entityType: TypeCibleQuarantaine;
  readonly entityId: string;
  readonly motif: string;
  readonly entreParIdentiteSub: string;
  // OBLIGATOIRE et sans valeur par défaut : aucune durée de quarantaine n'étant décidée
  // (ADR-069 §durée), elle ne peut pas être calculée pour l'appelant. L'y mettre un jour par défaut
  // ferait d'une règle de conservation une autorisation de purge.
  readonly revalidationDueLe: Date;
}

export type ResultatCreationQuarantaine =
  | { statut: "creee"; quarantaine: Quarantaine }
  // La cible n'existe pas DANS CE WORKSPACE. Les deux cas — absente, ou appartenant à un autre
  // workspace — sont volontairement indistinguables.
  | { statut: "cible_introuvable" }
  | { statut: "deja_active"; quarantaine: Quarantaine }
  // LEGAL HOLD PRIORITAIRE À L'ENTRÉE (ADR-069 §legal hold, décision A) : entrer en quarantaine est
  // un pas délibéré vers une future purge, et le faire sur une pièce juridiquement protégée
  // afficherait une progression vers la suppression de ce qui doit être conservé.
  | { statut: "bloquee_par_legal_hold" };

export interface EntreeLeveeQuarantaine {
  readonly causeLevee: CauseLeveeQuarantaine;
  readonly motifLevee: string;
  readonly leveeParIdentiteSub: string;
}

export type ResultatLeveeQuarantaine =
  | { statut: "levee"; quarantaine: Quarantaine }
  | { statut: "introuvable" }
  // Déjà levée — idempotence lisible. La levée d'origine (auteur, date, cause, motif) n'est jamais
  // écrasée par une seconde.
  | { statut: "deja_levee"; quarantaine: Quarantaine };

type LigneQuarantaine = typeof retentionQuarantines.$inferSelect;

function ligneVersQuarantaine(ligne: LigneQuarantaine): Quarantaine {
  return {
    id: ligne.id,
    workspaceId: ligne.workspaceId,
    // Les vocabulaires sont garantis par un CHECK en base ET validés à l'écriture : la lecture n'a
    // pas à se défendre une troisième fois, et la contrainte SQL ne peut pas être contournée par un
    // chemin applicatif.
    policyCode: ligne.policyCode as PolitiqueQuarantaine,
    entityType: ligne.entityType as TypeCibleQuarantaine,
    entityId: ligne.entityId,
    motif: ligne.motif,
    entreLe: ligne.entreLe,
    entreParIdentiteSub: ligne.entreParIdentiteSub,
    revalidationDueLe: ligne.revalidationDueLe,
    leveeLe: ligne.leveeLe ?? undefined,
    leveeParIdentiteSub: ligne.leveeParIdentiteSub ?? undefined,
    causeLevee: (ligne.causeLevee ?? undefined) as CauseLeveeQuarantaine | undefined,
    motifLevee: ligne.motifLevee ?? undefined,
  };
}

// LECTURE MINIMALE de la cible, et PREUVE d'appartenance par jointure dans le `WHERE`.
// `bons_visite` ne porte pas `workspace_id` : c'est une feuille (ADR-054 §7) dont l'appartenance se
// dérive par `visites -> biens`. Ni snapshot, ni identité du signataire, ni clé de stockage : la
// revalidation a besoin du statut et de la date de signature, et de rien d'autre.
async function lireCible(
  entityType: TypeCibleQuarantaine,
  entityId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<{ statut: string; signeLe?: Date } | undefined> {
  if (!UUID_REGEX.test(entityId)) return undefined;

  // `switch` exhaustif sur le vocabulaire fermé : le jour où un second type de cible est ajouté,
  // TypeScript signale ce point précis comme incomplet.
  switch (entityType) {
    case "bons_visite": {
      const [trouve] = await executeur
        .select({ statut: bonsVisite.statut, signeLe: bonsVisite.signeLe })
        .from(bonsVisite)
        .innerJoin(visites, eq(bonsVisite.visiteId, visites.id))
        .innerJoin(biens, eq(visites.bienId, biens.id))
        .where(and(eq(bonsVisite.id, entityId), eq(biens.workspaceId, workspaceId)))
        .limit(1);
      return trouve ? { statut: trouve.statut, signeLe: trouve.signeLe ?? undefined } : undefined;
    }
  }
}

// La cible relève-t-elle TOUJOURS de la politique ? Recalculé sur les données fraîches par le
// moteur PUR, jamais repris de l'évaluation qui avait conduit à l'entrée — c'est exactement ce que
// « revalider » veut dire.
//
// `sousLegalHoldActif: false` est passé À DESSEIN : la présence d'un hold est une question
// DISTINCTE, déjà tranchée en amont par `revaliderQuarantainePure` avec son propre verdict. La
// mélanger ici produirait `POLITIQUE_NON_APPLICABLE` pour une pièce simplement protégée, ce qui
// conduirait à lever la quarantaine au lieu de la maintenir bloquée.
function politiqueToujoursApplicable(
  policyCode: PolitiqueQuarantaine,
  cible: { statut: string; signeLe?: Date },
  entityId: string,
  instantReference: Date
): boolean {
  switch (policyCode) {
    case "SIGNED_VISIT_FORM": {
      const politique = POLITIQUES_CONSERVATION_V1.find((p) => p.cle === "SIGNED_VISIT_FORM");
      if (!politique) return false;
      const dureeAnnees = dureeAnneesPourDeclencheur(politique, "SIGNED_AT");
      // Durée introuvable : fail-closed. Une politique dont on ne sait plus lire la durée n'est pas
      // « toujours applicable », elle est inévaluable.
      if (dureeAnnees === undefined) return false;
      const evaluation = evaluerBonVisiteSigne(
        { id: entityId, workspaceId: "", statut: cible.statut, signeLe: cible.signeLe, sousLegalHoldActif: false },
        instantReference,
        dureeAnnees
      );
      return evaluation.statut === "ELIGIBLE";
    }
  }
}

async function relireQuarantaineActive(
  entree: Pick<EntreeCreationQuarantaine, "entityType" | "entityId" | "policyCode">,
  workspaceId: string,
  executeur: Executeur
): Promise<Quarantaine | undefined> {
  const [ligne] = await executeur
    .select()
    .from(retentionQuarantines)
    .where(
      and(
        eq(retentionQuarantines.workspaceId, workspaceId),
        eq(retentionQuarantines.entityType, entree.entityType),
        eq(retentionQuarantines.entityId, entree.entityId),
        eq(retentionQuarantines.policyCode, entree.policyCode),
        isNull(retentionQuarantines.leveeLe)
      )
    )
    .limit(1);
  return ligne ? ligneVersQuarantaine(ligne) : undefined;
}

// ENTRÉE EN QUARANTAINE — geste DÉLIBÉRÉ, jamais déclenché par un balayage. Aucun chemin du produit
// ne l'appelle à la sortie de ce lot : la création reste réservée au futur lot d'enforcement, et le
// dry-run est lecteur seul (ADR-069 §dry-run).
//
// `entre_le` est laissé au DEFAULT `now()` de la base : la date d'un acte du registre vient de
// l'horloge du serveur de base, seule référence commune à tous les appelants.
//
// CONCURRENCE : aucune lecture-puis-écriture sur l'unicité. L'INSERT est tenté et c'est l'index
// partiel `retention_quarantines_cible_active_unique` qui tranche la course.
export async function creerQuarantaine(
  entree: EntreeCreationQuarantaine,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationQuarantaine> {
  // Validation AVANT toute lecture : une entrée malformée est une erreur d'appel, pas un état du
  // registre, et elle ne doit consommer aucune requête.
  const policyCode = validerPolitiqueQuarantaine(entree.policyCode);
  const entityType = validerTypeCibleQuarantaine(entree.entityType);
  const motif = validerMotifQuarantaine(entree.motif, "motif");
  const entreParIdentiteSub = validerIdentiteSubQuarantaine(entree.entreParIdentiteSub, "entreParIdentiteSub");
  const perimetre = validerWorkspaceIdQuarantaine(workspaceId);
  // L'échéance est comparée à MAINTENANT plutôt qu'à `entre_le`, qui n'existe pas encore : le CHECK
  // `retention_quarantines_echeance_apres_entree_check` tranche définitivement en base.
  const revalidationDueLe = validerEcheanceRevalidation(entree.revalidationDueLe, new Date());

  if ((await lireCible(entityType, entree.entityId, perimetre, executeur)) === undefined) {
    return { statut: "cible_introuvable" };
  }

  // LEGAL HOLD AVANT TOUT. Une erreur de lecture ici REMONTE — elle n'est ni rattrapée, ni convertie
  // en « aucun hold » : ouvrir une quarantaine parce qu'on n'a pas su lire les protections serait
  // exactement la panne que ce domaine doit rendre impossible.
  const ciblesProtegees = await listerCiblesSousLegalHoldActif(entityType, perimetre, executeur);
  if (ciblesProtegees.has(entree.entityId)) return { statut: "bloquee_par_legal_hold" };

  try {
    const [ligne] = await executeur
      .insert(retentionQuarantines)
      .values({
        workspaceId: perimetre,
        policyCode,
        entityType,
        entityId: entree.entityId,
        motif,
        entreParIdentiteSub,
        revalidationDueLe,
      })
      .returning();
    return { statut: "creee", quarantaine: ligneVersQuarantaine(ligne) };
  } catch (erreur) {
    if (!estViolationQuarantaineActiveUnique(erreur)) throw erreur;
    const existante = await relireQuarantaineActive({ entityType, entityId: entree.entityId, policyCode }, perimetre, executeur);
    // La quarantaine concurrente peut avoir été levée entre la violation et cette relecture. Ne rien
    // inventer : propager l'erreur d'origine est plus honnête qu'un `deja_active` sans ligne à
    // montrer, ou qu'un `creee` qui n'a pas eu lieu.
    if (!existante) throw erreur;
    return { statut: "deja_active", quarantaine: existante };
  }
}

// SORTIE NON DESTRUCTIVE — un UPDATE, jamais un DELETE.
//
// IDEMPOTENCE PAR LA BASE, idiome du « gel concurrent » (`tacheRepository`, `envoiEmailRepository`,
// `legalHoldRepository`) : la condition `levee_le IS NULL` est DANS le `WHERE`. Deux levées
// simultanées ne peuvent pas toutes deux écrire ; la seconde ne met à jour aucune ligne et relit
// l'état réel.
//
// Lever une quarantaine ne touche PAS la ressource métier : aucune table métier n'est écrite ici.
export async function leverQuarantaine(
  id: string,
  entree: EntreeLeveeQuarantaine,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatLeveeQuarantaine> {
  const causeLevee = validerCauseLevee(entree.causeLevee);
  const motifLevee = validerMotifQuarantaine(entree.motifLevee, "motifLevee");
  const leveeParIdentiteSub = validerIdentiteSubQuarantaine(entree.leveeParIdentiteSub, "leveeParIdentiteSub");
  const perimetre = validerWorkspaceIdQuarantaine(workspaceId);

  if (!UUID_REGEX.test(id)) return { statut: "introuvable" };

  const [levee] = await executeur
    .update(retentionQuarantines)
    // `new Date()` côté applicatif, convention du dépôt pour une mutation ; le CHECK
    // `retention_quarantines_levee_apres_entree_check` refuse en base une levée antérieure à
    // l'entrée.
    .set({ leveeLe: new Date(), leveeParIdentiteSub, causeLevee, motifLevee })
    .where(
      and(
        eq(retentionQuarantines.id, id),
        eq(retentionQuarantines.workspaceId, perimetre),
        isNull(retentionQuarantines.leveeLe)
      )
    )
    .returning();

  if (levee) return { statut: "levee", quarantaine: ligneVersQuarantaine(levee) };

  const existante = await obtenirQuarantaine(id, perimetre, executeur);
  if (!existante) return { statut: "introuvable" };
  return { statut: "deja_levee", quarantaine: existante };
}

export async function obtenirQuarantaine(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Quarantaine | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select()
    .from(retentionQuarantines)
    .where(and(eq(retentionQuarantines.id, id), eq(retentionQuarantines.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersQuarantaine(ligne) : undefined;
}

export async function obtenirQuarantaineActive(
  entityType: TypeCibleQuarantaine,
  entityId: string,
  policyCode: PolitiqueQuarantaine,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Quarantaine | undefined> {
  return relireQuarantaineActive(
    {
      entityType: validerTypeCibleQuarantaine(entityType),
      entityId,
      policyCode: validerPolitiqueQuarantaine(policyCode),
    },
    validerWorkspaceIdQuarantaine(workspaceId),
    executeur
  );
}

// HISTORIQUE COMPLET d'une cible : quarantaines actives ET levées, dans l'ordre d'entrée. C'est la
// lecture d'audit — celle qui montre ce qui a été envisagé, puis abandonné, par qui et pourquoi.
// `ordre` et non `entre_le` : deux entrées dans la même microseconde doivent rester départagées.
export async function listerQuarantainesDeLaCible(
  entityType: TypeCibleQuarantaine,
  entityId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Quarantaine[]> {
  const lignes = await executeur
    .select()
    .from(retentionQuarantines)
    .where(
      and(
        eq(retentionQuarantines.workspaceId, workspaceId),
        eq(retentionQuarantines.entityType, validerTypeCibleQuarantaine(entityType)),
        eq(retentionQuarantines.entityId, entityId)
      )
    )
    .orderBy(asc(retentionQuarantines.ordre));
  return lignes.map(ligneVersQuarantaine);
}

export async function listerQuarantainesActives(
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Quarantaine[]> {
  const lignes = await executeur
    .select()
    .from(retentionQuarantines)
    .where(and(eq(retentionQuarantines.workspaceId, workspaceId), isNull(retentionQuarantines.leveeLe)))
    .orderBy(asc(retentionQuarantines.ordre));
  return lignes.map(ligneVersQuarantaine);
}

// LA lecture du dry-run de rétention : l'ensemble des identifiants de cibles actuellement en
// quarantaine, pour un workspace et un type. Un ensemble et non des lignes — le moteur n'a besoin
// que de « en quarantaine ou non », et ne doit recevoir ni motif, ni auteur, ni échéance.
//
// Une erreur de lecture REMONTE, propriété fail-closed du chantier : l'appelant la convertit en
// politique BLOQUÉE, jamais en « aucune quarantaine ».
export async function listerCiblesEnQuarantaineActive(
  entityType: TypeCibleQuarantaine,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Set<string>> {
  const lignes = await executeur
    .select({ entityId: retentionQuarantines.entityId })
    .from(retentionQuarantines)
    .where(
      and(
        eq(retentionQuarantines.workspaceId, workspaceId),
        eq(retentionQuarantines.entityType, validerTypeCibleQuarantaine(entityType)),
        isNull(retentionQuarantines.leveeLe)
      )
    );
  return new Set(lignes.map((ligne) => ligne.entityId));
}

// REVALIDATION — une LECTURE qui rend un verdict, et qui n'écrit rien.
//
// Elle n'écrit rien À DESSEIN : enregistrer chaque tentative demanderait une seconde table dont
// aucun consommateur n'existe, et la lecture doit pouvoir être rejouée autant de fois que nécessaire
// sans modifier l'état qu'elle observe. L'historique persisté est celui de la quarantaine
// elle-même : entrée, puis sortie. Journaliser les revalidations relèvera du lot d'enforcement, qui
// aura un usage de cette trace.
//
// AUCUN des verdicts possibles n'autorise une suppression, et cette fonction n'appelle aucun chemin
// de suppression : elle répond à une question. Les holds sont relus À CHAQUE appel sur les données
// fraîches — un hold posé APRÈS l'entrée en quarantaine bloque donc la revalidation, et l'expiration
// de l'échéance ne le contourne jamais (il est évalué avant elle).
export async function revaliderQuarantaineEnBase(
  id: string,
  workspaceId: string,
  instantReference: Date,
  executeur: Executeur = getDb()
): Promise<{ verdict: VerdictRevalidationQuarantaine; quarantaine: Quarantaine } | undefined> {
  const perimetre = validerWorkspaceIdQuarantaine(workspaceId);
  const quarantaine = await obtenirQuarantaine(id, perimetre, executeur);
  if (!quarantaine) return undefined;

  const cible = await lireCible(quarantaine.entityType, quarantaine.entityId, perimetre, executeur);
  // La lecture des holds n'est pas rattrapée : son échec remonte plutôt que de produire un contexte
  // qui conclurait « aucun blocage connu ».
  const ciblesProtegees = await listerCiblesSousLegalHoldActif(quarantaine.entityType, perimetre, executeur);

  const verdict = revaliderQuarantainePure(
    quarantaine,
    {
      cibleExiste: cible !== undefined,
      sousLegalHoldActif: ciblesProtegees.has(quarantaine.entityId),
      politiqueToujoursApplicable:
        cible !== undefined &&
        politiqueToujoursApplicable(quarantaine.policyCode, cible, quarantaine.entityId, instantReference),
    },
    instantReference
  );

  return { verdict, quarantaine };
}
