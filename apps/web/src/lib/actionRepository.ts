import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { actions as actionsTable } from "@/db/schema";
import { actionsMetier as actionsDemo } from "@/data/actions";
import type { ActionMetier, PrioriteAction, StatutAction, TypeActionMetier } from "@/types/action";

type LigneAction = typeof actionsTable.$inferSelect;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais interprété comme false/"aucun" — même principe que
// bienRepository.ts.
function ligneVersAction(ligne: LigneAction): ActionMetier {
  return {
    id: ligne.id,
    titre: ligne.titre,
    contexte: ligne.contexte ?? undefined,
    statut: ligne.statut as StatutAction,
    priorite: ligne.priorite as PrioriteAction,
    echeance: ligne.echeance ?? undefined,
    type: ligne.type as TypeActionMetier,
    bienId: ligne.bienId ?? undefined,
    acquereurId: ligne.acquereurId ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    termineLe: ligne.termineLe?.toISOString(),
  };
}

// Actions réelles si au moins une existe, sinon les actions de démonstration — jamais un
// mélange, même principe que listerBiens()/listerClients().
export async function listerActions(): Promise<ActionMetier[]> {
  try {
    const lignes = await getDb().select().from(actionsTable);
    if (lignes.length > 0) return lignes.map(ligneVersAction);
  } catch (erreur) {
    console.error("[actions] lecture Postgres indisponible, repli sur les mocks :", erreur);
  }
  return actionsDemo;
}

export async function getActionsPourBien(bienId: string): Promise<ActionMetier[]> {
  const actions = await listerActions();
  return actions.filter((a) => a.bienId === bienId);
}

export async function getActionsPourAcquereur(acquereurId: string): Promise<ActionMetier[]> {
  const actions = await listerActions();
  return actions.filter((a) => a.acquereurId === acquereurId);
}

export type NouvelleAction = Omit<ActionMetier, "id" | "statut" | "creeLe" | "termineLe">;

// Insertion pure : la validation métier (titre non vide, etc.) est de la responsabilité de
// l'appelant (Server Action), pas de ce repository.
export async function creerAction(input: NouvelleAction): Promise<ActionMetier> {
  const [ligne] = await getDb()
    .insert(actionsTable)
    .values({
      titre: input.titre,
      contexte: input.contexte ?? null,
      type: input.type,
      priorite: input.priorite,
      echeance: input.echeance ?? null,
      bienId: input.bienId ?? null,
      acquereurId: input.acquereurId ?? null,
    })
    .returning();
  return ligneVersAction(ligne);
}

// Pose statut et termineLe dans la même écriture SQL — jamais deux requêtes séparées, pour
// éviter qu'une action se retrouve "terminée" sans termineLe (ou l'inverse) en cas de panne
// entre les deux. Un id mocké (non-UUID, ex. "act-001") ne correspond à aucune ligne réelle :
// no-op plutôt qu'une erreur de cast Postgres sur la colonne uuid.
export async function terminerAction(id: string): Promise<void> {
  if (!UUID_REGEX.test(id)) return;
  await getDb()
    .update(actionsTable)
    .set({ statut: "termine", termineLe: new Date() })
    .where(eq(actionsTable.id, id));
}
