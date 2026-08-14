import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { executionsAutomatisation } from "@/db/schema";
import type { CodeRegleAutomatisation, ExecutionAutomatisation } from "@/types/automatisation";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ligneVersExecution(ligne: typeof executionsAutomatisation.$inferSelect): ExecutionAutomatisation {
  return {
    id: ligne.id,
    regleCode: ligne.regleCode as CodeRegleAutomatisation,
    evenementId: ligne.evenementId,
    tacheId: ligne.tacheId ?? undefined,
    demarreeLe: ligne.demarreeLe.toISOString(),
    reussieLe: ligne.reussieLe?.toISOString(),
    echoueeLe: ligne.echoueeLe?.toISOString(),
    erreurTechnique: ligne.erreurTechnique ?? undefined,
  };
}

export async function getExecutionAutomatisationById(id: string): Promise<ExecutionAutomatisation | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(executionsAutomatisation).where(eq(executionsAutomatisation.id, id)).limit(1);
  return ligne ? ligneVersExecution(ligne) : undefined;
}

export async function getDerniereExecutionPourRegle(regleCode: CodeRegleAutomatisation): Promise<ExecutionAutomatisation | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(executionsAutomatisation)
    .where(eq(executionsAutomatisation.regleCode, regleCode))
    .orderBy(desc(executionsAutomatisation.demarreeLe))
    .limit(1);
  return ligne ? ligneVersExecution(ligne) : undefined;
}

// Verrouille la ligne pour le traitement (ADR-032, correction n°6) — appelée à l'intérieur d'une
// transaction dédiée par exécution, jamais en dehors. Ne retourne rien si la ligne est déjà
// résolue (reussie/echouee) ou verrouillée par une autre transaction concurrente : rien à
// retraiter, jamais un double traitement.
export async function verrouillerExecutionATraiter(id: string, executeur: Executeur): Promise<ExecutionAutomatisation | undefined> {
  const [ligne] = await executeur
    .select()
    .from(executionsAutomatisation)
    .where(and(eq(executionsAutomatisation.id, id), isNull(executionsAutomatisation.reussieLe), isNull(executionsAutomatisation.echoueeLe)))
    .for("update");
  return ligne ? ligneVersExecution(ligne) : undefined;
}

// Pose tacheId + reussieLe DANS LA MÊME transaction que la création de la tâche elle-même
// (ADR-032, correction n°6) — jamais une tâche créée puis une mise à jour séparée qui pourrait
// laisser une tâche orpheline de son audit si le process s'arrête entre les deux.
export async function marquerExecutionReussie(id: string, tacheId: string | undefined, executeur: Executeur): Promise<void> {
  await executeur
    .update(executionsAutomatisation)
    .set({ tacheId: tacheId ?? null, reussieLe: new Date() })
    .where(and(eq(executionsAutomatisation.id, id), isNull(executionsAutomatisation.reussieLe), isNull(executionsAutomatisation.echoueeLe)));
}

// Écriture SÉPARÉE, volontairement hors de la transaction qui vient d'échouer (elle a déjà été
// annulée par Postgres à ce stade, impossible d'y écrire quoi que ce soit) — gel concurrent par
// les mêmes gardes IS NULL, même si en pratique une seule tentative de traitement existe par ligne
// en V1 (aucun worker, aucun retry automatique).
export async function marquerExecutionEchouee(id: string, erreurTechnique: string): Promise<void> {
  await getDb()
    .update(executionsAutomatisation)
    .set({ echoueeLe: new Date(), erreurTechnique })
    .where(and(eq(executionsAutomatisation.id, id), isNull(executionsAutomatisation.reussieLe), isNull(executionsAutomatisation.echoueeLe)));
}
