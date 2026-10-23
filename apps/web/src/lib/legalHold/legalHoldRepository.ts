import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { biens, bonsVisite, legalHolds, visites } from "@/db/schema";
import {
  validerIdentiteSub,
  validerMotif,
  validerMotifCode,
  validerTypeCible,
  validerWorkspaceId,
  type LegalHold,
} from "./legalHold";
import type { MotifLegalHold, TypeCibleLegalHold } from "./statutsLegalHold";

// LEGAL_HOLD_FOUNDATION_V1 (ADR-068) — seul point de ce chantier qui parle à Postgres (ADR-007).
//
// CE MODULE NE SUPPRIME RIEN. Il INSÈRE un hold, il UPDATE sa levée, il LIT. Aucun `.delete()`,
// aucun DELETE SQL, aucun accès au système de fichiers, aucun appel à `supprimerFichierStocke` :
// lever un hold rend une ressource de nouveau CALCULABLE par le dry-run de rétention, et rien de
// plus — il n'existe dans le produit aucun chemin qui supprime quoi que ce soit (`APPLY_SUPPORTED`
// reste false).
//
// IMMUTABILITÉ DU REGISTRE : la seule mutation autorisée est la transition « actif -> levé », et
// elle n'écrase aucune information de pose. Lever n'est pas supprimer la ligne — un hold levé reste
// lisible, avec son motif d'origine, son auteur, sa date, puis le trio de la levée. Aucune fonction
// de ce fichier ne permet de modifier `motif`, `pose_le` ni `pose_par_identite_sub` après coup.
//
// WORKSPACE : `legal_holds` est une RACINE (ADR-054 §7) et porte son `workspace_id`. Toute fonction
// reçoit donc le périmètre en PARAMÈTRE — jamais lu depuis la session ici — et le place dans le
// `WHERE`, y compris pour l'UPDATE de levée. Un hold d'un autre workspace est INTROUVABLE, et non
// « visible mais refusé » : c'est le même patron que `bonVisiteRepository`, et il ne laisse pas
// fuiter l'existence d'une ligne par la différence entre deux messages d'erreur.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Violation d'unicité PostgreSQL. La pose concurrente du même hold n'est pas une anomalie à
// propager : c'est le résultat attendu d'une course que l'index partiel a tranchée correctement.
const CODE_VIOLATION_UNICITE = "23505";
// NOMMÉE, et pas seulement reconnue par son code : un `23505` quelconque peut venir d'une TOUTE
// autre contrainte, et le traiter comme « ce hold existe déjà » masquerait un défaut réel derrière
// un résultat rassurant. Seule la contrainte que ce chemin est censé heurter est absorbée.
const CONTRAINTE_HOLD_ACTIF_UNIQUE = "legal_holds_cible_actif_unique";

// Drizzle ENVELOPPE l'erreur du driver : le code et le nom de contrainte sont sur la cause, pas sur
// l'erreur reçue. La chaîne est donc parcourue — sans quoi la garde ne reconnaîtrait jamais rien et
// toute pose concurrente remonterait comme une panne.
function estViolationHoldActifUnique(erreur: unknown): boolean {
  let courante: unknown = erreur;
  for (let profondeur = 0; courante !== null && courante !== undefined && profondeur < 5; profondeur += 1) {
    const candidate = courante as { code?: string; constraint_name?: string; cause?: unknown };
    if (candidate.code === CODE_VIOLATION_UNICITE && candidate.constraint_name === CONTRAINTE_HOLD_ACTIF_UNIQUE) {
      return true;
    }
    courante = candidate.cause;
  }
  return false;
}

export interface EntreeCreationLegalHold {
  readonly entityType: TypeCibleLegalHold;
  readonly entityId: string;
  readonly motifCode: MotifLegalHold;
  readonly motif: string;
  readonly poseParIdentiteSub: string;
}

export type ResultatCreationLegalHold =
  | { statut: "cree"; hold: LegalHold }
  // La cible n'existe pas DANS CE WORKSPACE. Les deux cas — absente, ou appartenant à un autre
  // workspace — sont volontairement indistinguables : distinguer renseignerait sur l'existence
  // d'une ligne hors périmètre.
  | { statut: "cible_introuvable" }
  // Un hold actif de même cible et même motif existe déjà. Rendu AVEC le hold en place : l'appelant
  // doit pouvoir montrer la protection existante plutôt qu'un simple refus.
  | { statut: "deja_actif"; hold: LegalHold };

export interface EntreeLeveeLegalHold {
  readonly motifLevee: string;
  readonly leveParIdentiteSub: string;
}

export type ResultatLeveeLegalHold =
  | { statut: "leve"; hold: LegalHold }
  | { statut: "introuvable" }
  // Déjà levé — idempotence lisible, et le hold est rendu tel qu'il est : la levée d'origine (son
  // auteur, sa date, son motif) n'est jamais écrasée par une seconde levée.
  | { statut: "deja_leve"; hold: LegalHold };

type LigneLegalHold = typeof legalHolds.$inferSelect;

function ligneVersLegalHold(ligne: LigneLegalHold): LegalHold {
  return {
    id: ligne.id,
    workspaceId: ligne.workspaceId,
    // Les deux vocabulaires sont garantis par un CHECK en base ET validés à l'écriture : la lecture
    // n'a donc pas à se défendre une troisième fois. Le `as` est sûr parce que la contrainte SQL,
    // elle, ne peut pas être contournée par un chemin applicatif.
    entityType: ligne.entityType as TypeCibleLegalHold,
    entityId: ligne.entityId,
    motifCode: ligne.motifCode as MotifLegalHold,
    motif: ligne.motif,
    poseLe: ligne.poseLe,
    poseParIdentiteSub: ligne.poseParIdentiteSub,
    leveLe: ligne.leveLe ?? undefined,
    leveParIdentiteSub: ligne.leveParIdentiteSub ?? undefined,
    motifLevee: ligne.motifLevee ?? undefined,
  };
}

// PREUVE D'APPARTENANCE DE LA CIBLE, par jointure et dans le `WHERE`. `bons_visite` ne porte pas
// `workspace_id` : c'est une feuille (ADR-054 §7) et son appartenance se dérive par
// `visites -> biens`. C'est exactement la requête de `listerCandidatsBonVisitePourRetention`, et
// c'est elle qui remplace la FK que cette table ne peut pas porter (voir l'en-tête de la migration
// 0061) : poser un hold sur une cible qu'on n'a pas prouvée serait poser une protection sur rien.
async function cibleExisteDansWorkspace(
  entityType: TypeCibleLegalHold,
  entityId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<boolean> {
  if (!UUID_REGEX.test(entityId)) return false;

  // `switch` exhaustif sur le vocabulaire fermé plutôt qu'une table de correspondance : le jour où
  // un second type de cible est ajouté, TypeScript signale ce point précis comme incomplet, au lieu
  // de laisser un type non vérifiable passer silencieusement.
  switch (entityType) {
    case "bons_visite": {
      const [trouve] = await executeur
        .select({ id: bonsVisite.id })
        .from(bonsVisite)
        .innerJoin(visites, eq(bonsVisite.visiteId, visites.id))
        .innerJoin(biens, eq(visites.bienId, biens.id))
        .where(and(eq(bonsVisite.id, entityId), eq(biens.workspaceId, workspaceId)))
        .limit(1);
      return trouve !== undefined;
    }
  }
}

async function relireHoldActif(
  entree: Pick<EntreeCreationLegalHold, "entityType" | "entityId" | "motifCode">,
  workspaceId: string,
  executeur: Executeur
): Promise<LegalHold | undefined> {
  const [ligne] = await executeur
    .select()
    .from(legalHolds)
    .where(
      and(
        eq(legalHolds.workspaceId, workspaceId),
        eq(legalHolds.entityType, entree.entityType),
        eq(legalHolds.entityId, entree.entityId),
        eq(legalHolds.motifCode, entree.motifCode),
        isNull(legalHolds.leveLe)
      )
    )
    .limit(1);
  return ligne ? ligneVersLegalHold(ligne) : undefined;
}

// POSE d'un hold.
//
// `pose_le` est laissé au DEFAULT `now()` de la base plutôt que fixé en JS : la date d'un acte du
// registre doit venir de l'horloge du serveur de base, seule référence commune à tous les appelants.
//
// CONCURRENCE : aucune lecture-puis-écriture. L'INSERT est tenté directement et c'est l'index
// partiel `legal_holds_cible_actif_unique` qui tranche la course ; la violation d'unicité est ensuite
// traduite en `deja_actif` après relecture. Un `SELECT ... puis INSERT si absent` aurait laissé deux
// poses simultanées passer toutes les deux, quel que soit le soin apporté au code applicatif.
export async function creerLegalHold(
  entree: EntreeCreationLegalHold,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatCreationLegalHold> {
  // Validation AVANT toute lecture : une entrée malformée est une erreur d'appel, pas un état du
  // registre, et elle ne doit pas consommer une requête.
  const entityType = validerTypeCible(entree.entityType);
  const motifCode = validerMotifCode(entree.motifCode);
  const motif = validerMotif(entree.motif, "motif");
  const poseParIdentiteSub = validerIdentiteSub(entree.poseParIdentiteSub, "poseParIdentiteSub");
  const perimetre = validerWorkspaceId(workspaceId);

  if (!(await cibleExisteDansWorkspace(entityType, entree.entityId, perimetre, executeur))) {
    return { statut: "cible_introuvable" };
  }

  try {
    const [ligne] = await executeur
      .insert(legalHolds)
      .values({ workspaceId: perimetre, entityType, entityId: entree.entityId, motifCode, motif, poseParIdentiteSub })
      .returning();
    return { statut: "cree", hold: ligneVersLegalHold(ligne) };
  } catch (erreur) {
    if (!estViolationHoldActifUnique(erreur)) throw erreur;
    const existant = await relireHoldActif({ entityType, entityId: entree.entityId, motifCode }, perimetre, executeur);
    // Le hold concurrent peut avoir été levé entre la violation et cette relecture. Ne rien
    // inventer dans ce cas : propager l'erreur d'origine est plus honnête que de rendre un
    // `deja_actif` sans hold à montrer, ou un `cree` qui n'a pas eu lieu.
    if (!existant) throw erreur;
    return { statut: "deja_actif", hold: existant };
  }
}

// LEVÉE d'un hold — une seule transition, et elle n'efface rien.
//
// IDEMPOTENCE PAR LA BASE, idiome du « gel concurrent » déjà utilisé par `tacheRepository` et
// `envoiEmailRepository` : la condition `leve_le IS NULL` est DANS le `WHERE` de l'UPDATE. Deux
// levées simultanées ne peuvent donc pas toutes deux écrire ; la seconde ne met à jour aucune ligne
// et relit l'état réel. Une vérification applicative préalable aurait laissé la seconde écraser
// l'auteur et le motif de la première.
//
// Le `workspace_id` est dans le même `WHERE` : un hold d'un autre workspace n'est pas « refusé », il
// est introuvable, et aucune de ses colonnes n'est lue.
export async function leverLegalHold(
  id: string,
  entree: EntreeLeveeLegalHold,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ResultatLeveeLegalHold> {
  const motifLevee = validerMotif(entree.motifLevee, "motifLevee");
  const leveParIdentiteSub = validerIdentiteSub(entree.leveParIdentiteSub, "leveParIdentiteSub");
  const perimetre = validerWorkspaceId(workspaceId);

  if (!UUID_REGEX.test(id)) return { statut: "introuvable" };

  const [levee] = await executeur
    .update(legalHolds)
    // `new Date()` côté applicatif, convention du dépôt pour une mutation (jamais `sql\`now()\``) ;
    // le CHECK `legal_holds_levee_apres_pose_check` refuse en base une levée antérieure à la pose.
    .set({ leveLe: new Date(), leveParIdentiteSub, motifLevee })
    .where(and(eq(legalHolds.id, id), eq(legalHolds.workspaceId, perimetre), isNull(legalHolds.leveLe)))
    .returning();

  if (levee) return { statut: "leve", hold: ligneVersLegalHold(levee) };

  // Aucune ligne mise à jour : soit le hold n'existe pas dans ce workspace, soit il était déjà levé.
  // Les deux sont des états normaux et doivent être distingués pour l'appelant, mais seulement
  // DANS le périmètre.
  const existant = await obtenirLegalHold(id, perimetre, executeur);
  if (!existant) return { statut: "introuvable" };
  return { statut: "deja_leve", hold: existant };
}

export async function obtenirLegalHold(
  id: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<LegalHold | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .select()
    .from(legalHolds)
    .where(and(eq(legalHolds.id, id), eq(legalHolds.workspaceId, workspaceId)))
    .limit(1);
  return ligne ? ligneVersLegalHold(ligne) : undefined;
}

// HISTORIQUE COMPLET d'une cible : holds actifs ET levés, dans l'ordre de pose. C'est la lecture
// d'audit — celle qui doit montrer qu'un hold a existé puis a été levé, par qui et pourquoi.
// `ordre` et non `pose_le` : deux poses dans la même microseconde doivent rester départagées.
export async function listerLegalHoldsDeLaCible(
  entityType: TypeCibleLegalHold,
  entityId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<LegalHold[]> {
  const lignes = await executeur
    .select()
    .from(legalHolds)
    .where(
      and(
        eq(legalHolds.workspaceId, workspaceId),
        eq(legalHolds.entityType, validerTypeCible(entityType)),
        eq(legalHolds.entityId, entityId)
      )
    )
    .orderBy(asc(legalHolds.ordre));
  return lignes.map(ligneVersLegalHold);
}

export async function listerLegalHoldsActifs(
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<LegalHold[]> {
  const lignes = await executeur
    .select()
    .from(legalHolds)
    .where(and(eq(legalHolds.workspaceId, workspaceId), isNull(legalHolds.leveLe)))
    .orderBy(asc(legalHolds.ordre));
  return lignes.map(ligneVersLegalHold);
}

// LA lecture du moteur de rétention : l'ensemble des identifiants de cibles PROTÉGÉES, pour un
// workspace et un type. Un ensemble et non une liste de holds — le moteur n'a besoin de savoir que
// « protégée ou non », et ne doit recevoir ni motif, ni auteur, ni date : un texte de motif décrit
// une affaire, et un moteur qui compte des échéances n'en a aucun usage.
//
// Une erreur de lecture ici REMONTE, et c'est la propriété fail-closed du chantier : l'appelant
// (`evaluerPolitiquePourWorkspace`) la convertit en politique BLOQUÉE, jamais en « aucun hold ».
// Rendre un ensemble vide sur échec aurait produit des candidats ÉLIGIBLES alors que des holds
// existaient.
export async function listerCiblesSousLegalHoldActif(
  entityType: TypeCibleLegalHold,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Set<string>> {
  const lignes = await executeur
    .select({ entityId: legalHolds.entityId })
    .from(legalHolds)
    .where(
      and(
        eq(legalHolds.workspaceId, workspaceId),
        eq(legalHolds.entityType, validerTypeCible(entityType)),
        isNull(legalHolds.leveLe)
      )
    );
  return new Set(lignes.map((ligne) => ligne.entityId));
}
