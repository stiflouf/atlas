import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { exigerContactActif } from "@/lib/contactActif";
import {
  biens as biensTable,
  interactions as interactionsTable,
  projetsAcquereur as projetsAcquereurTable,
  projetsVendeur as projetsVendeurTable,
  visites as visitesTable,
} from "@/db/schema";
import type { Interaction, NatureMetierInteraction, SensInteraction, TypeInteraction } from "@/types/interaction";

// ADR-055 §G — accès aux interactions canoniques. Volontairement réduit à créer, relire, et
// parcourir la chronologie d'un contact. Aucune fonction d'agrégation, aucune « mémoire
// relationnelle » : la vue unifiée restera DÉRIVÉE à la lecture, sur le patron de
// `memoireAcquereur.ts`, jamais une table ni un cache.

type LigneInteraction = typeof interactionsTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier : un appel sans contenu noté n'a pas un contenu vide, il n'en
// a pas.
function ligneVersInteraction(ligne: LigneInteraction): Interaction {
  return {
    id: ligne.id,
    contactId: ligne.contactId,
    type: ligne.type as TypeInteraction,
    sens: (ligne.sens as SensInteraction | null) ?? undefined,
    survenuLe: ligne.survenuLe.toISOString(),
    contenu: ligne.contenu ?? undefined,
    projetAcquereurId: ligne.projetAcquereurId ?? undefined,
    projetVendeurId: ligne.projetVendeurId ?? undefined,
    bienId: ligne.bienId ?? undefined,
    visiteId: ligne.visiteId ?? undefined,
    natureMetier: (ligne.natureMetier as NatureMetierInteraction | null) ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// AU PLUS un contexte, garanti par le type comme il l'est par le `CHECK` en base : les quatre
// cibles sont mutuellement exclusives, et aucune n'est obligatoire. `visiteId` ajouté par
// SELLER_FEEDBACK_INTERACTION_V1 (ADR-063).
export type ContexteInteraction =
  | { projetAcquereurId: string; projetVendeurId?: never; bienId?: never; visiteId?: never }
  | { projetVendeurId: string; projetAcquereurId?: never; bienId?: never; visiteId?: never }
  | { bienId: string; projetAcquereurId?: never; projetVendeurId?: never; visiteId?: never }
  | { visiteId: string; projetAcquereurId?: never; projetVendeurId?: never; bienId?: never }
  | { projetAcquereurId?: never; projetVendeurId?: never; bienId?: never; visiteId?: never };

export type NouvelleInteraction = {
  contactId: string;
  type: TypeInteraction;
  sens?: SensInteraction;
  // Obligatoire : dater un échange du moment où on le saisit inventerait une chronologie. Un import
  // futur enregistrera des faits vieux de six mois, et c'est leur date qui compte.
  survenuLe: string;
  contenu?: string;
  // SELLER_FEEDBACK_INTERACTION_V1 — orthogonal au contexte : QUEL fait métier durable cet échange
  // affirme, jamais QUEL canal l'a porté. `undefined` pour la grande majorité des interactions.
  natureMetier?: NatureMetierInteraction;
} & ContexteInteraction;

// Lit le périmètre du contexte visé, quel qu'il soit. Retourne undefined si la cible n'existe pas.
async function workspaceDuContexte(
  input: NouvelleInteraction,
  executeur: Executeur
): Promise<{ trouve: boolean; workspaceId?: string }> {
  if (input.projetAcquereurId !== undefined) {
    const [cible] = await executeur
      .select({ workspaceId: projetsAcquereurTable.workspaceId })
      .from(projetsAcquereurTable)
      .where(eq(projetsAcquereurTable.id, input.projetAcquereurId))
      .limit(1);
    return { trouve: cible !== undefined, workspaceId: cible?.workspaceId };
  }
  if (input.projetVendeurId !== undefined) {
    const [cible] = await executeur
      .select({ workspaceId: projetsVendeurTable.workspaceId })
      .from(projetsVendeurTable)
      .where(eq(projetsVendeurTable.id, input.projetVendeurId))
      .limit(1);
    return { trouve: cible !== undefined, workspaceId: cible?.workspaceId };
  }
  if (input.bienId !== undefined) {
    const [cible] = await executeur
      .select({ workspaceId: biensTable.workspaceId })
      .from(biensTable)
      .where(eq(biensTable.id, input.bienId))
      .limit(1);
    return { trouve: cible !== undefined, workspaceId: cible?.workspaceId };
  }
  if (input.visiteId !== undefined) {
    // Visite -> Bien -> workspace (ADR-054 §7, même patron que `visiteRepository.ts` : `visites`
    // n'a pas de colonne `workspace_id` propre).
    const [cible] = await executeur
      .select({ workspaceId: biensTable.workspaceId })
      .from(visitesTable)
      .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
      .where(eq(visitesTable.id, input.visiteId))
      .limit(1);
    return { trouve: cible !== undefined, workspaceId: cible?.workspaceId };
  }
  // Aucun contexte : rien à vérifier, et c'est un cas valide.
  return { trouve: true };
}

// ADR-054 — `interactions` est une FEUILLE de `contacts` : aucun `workspaceId` n'est reçu ici, il
// serait l'occasion d'en choisir un qui contredise le contact.
//
// Quand un contexte est fourni, les deux périmètres doivent coïncider : la base ne peut pas le
// vérifier (aucune des deux tables ne porte le workspace côté interaction), donc ce chemin le fait
// et échoue bruyamment. Même garde et même raison que `ajouterPartieProjet` et `creerMandat`.
// ADR-059 §10 — le contact est lu SOUS VERROU dans une transaction (savepoint si l'appelant en a
// déjà une) : un contact absorbé refuse l'échange (`ErreurContactFusionne`), et une fusion
// concurrente ne peut pas laisser un échange orphelin sur l'absorbé — soit il est repointé par le
// moteur, soit il est refusé. Jamais réécrit vers le survivant.
export async function creerInteraction(
  input: NouvelleInteraction,
  executeur: Executeur = getDb()
): Promise<Interaction> {
  return executeur.transaction(async (tx) => {
  const { workspaceId: workspaceContact } = await exigerContactActif(input.contactId, tx);

  const contexte = await workspaceDuContexte(input, tx);
  if (!contexte.trouve) {
    throw new Error(
      `Contexte introuvable : ${input.projetAcquereurId ?? input.projetVendeurId ?? input.bienId}`
    );
  }
  if (contexte.workspaceId !== undefined && contexte.workspaceId !== workspaceContact) {
    throw new Error("Une interaction ne peut pas relier un contact et un contexte de workspaces différents");
  }

  const [ligne] = await tx
    .insert(interactionsTable)
    .values({
      contactId: input.contactId,
      type: input.type,
      sens: input.sens ?? null,
      survenuLe: new Date(input.survenuLe),
      contenu: input.contenu ?? null,
      projetAcquereurId: input.projetAcquereurId ?? null,
      projetVendeurId: input.projetVendeurId ?? null,
      bienId: input.bienId ?? null,
      visiteId: input.visiteId ?? null,
      natureMetier: input.natureMetier ?? null,
    })
    .returning();
  return ligneVersInteraction(ligne);
  });
}

export async function getInteractionById(id: string): Promise<Interaction | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(interactionsTable).where(eq(interactionsTable.id, id)).limit(1);
  return ligne ? ligneVersInteraction(ligne) : undefined;
}

// Chronologie du plus récent au plus ancien, sur la DATE MÉTIER : c'est l'ordre dans lequel une
// mémoire relationnelle se lit.
//
// Ordre TOTALEMENT déterministe, et c'est délibéré : deux interactions peuvent partager
// `survenu_le` à la seconde près (un import, une saisie en lot), et un tri partiel rendrait le
// résultat dépendant du plan d'exécution — donc des tests instables et un affichage qui change
// sans raison. `cree_le` départage d'abord (ce que DOMIORA a su en dernier), puis `id`, qui ne peut
// jamais être à égalité.
export async function listerInteractionsDuContact(contactId: string): Promise<Interaction[]> {
  if (!UUID_REGEX.test(contactId)) return [];
  const lignes = await getDb()
    .select()
    .from(interactionsTable)
    .where(eq(interactionsTable.contactId, contactId))
    .orderBy(desc(interactionsTable.survenuLe), desc(interactionsTable.creeLe), asc(interactionsTable.id));
  return lignes.map(ligneVersInteraction);
}

// SELLER_FEEDBACK_INTERACTION_V1 (ADR-063 §15/§42) — historique accessible depuis la fiche Visite
// elle-même, workspace-safe (Visite -> Bien -> workspace, même patron que `visiteRepository.ts`) —
// jamais un nouveau silo : ce lecteur ne fait que filtrer les MÊMES lignes déjà visibles via
// `listerInteractionsDuContact`, sur `visite_id` plutôt que `contact_id`.
export async function listerInteractionsPourVisite(
  visiteId: string,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<Interaction[]> {
  if (!UUID_REGEX.test(visiteId)) return [];
  const lignes = await executeur
    .select({ interaction: interactionsTable })
    .from(interactionsTable)
    .innerJoin(visitesTable, eq(interactionsTable.visiteId, visitesTable.id))
    .innerJoin(biensTable, eq(visitesTable.bienId, biensTable.id))
    .where(and(eq(interactionsTable.visiteId, visiteId), eq(biensTable.workspaceId, workspaceId)))
    .orderBy(desc(interactionsTable.survenuLe), desc(interactionsTable.creeLe), asc(interactionsTable.id));
  return lignes.map((l) => ligneVersInteraction(l.interaction));
}
