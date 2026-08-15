import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { evenementsMetier, executionsAutomatisation, taches } from "@/db/schema";
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

// Identité inter-cycle d'une règle réactive à une paire bien/acquéreur (ADR-037, ex.
// 'nouveau_match_bien_acquereur') — jamais une analyse de texte de tâche, jamais une nouvelle
// colonne redondante : réutilise la provenance déjà réelle du moteur ADR-032
// (executions_automatisation.tacheId -> taches, executions_automatisation.evenementId ->
// evenements_metier.bienId/acquereurId). Vrai SEULEMENT si une exécution PASSÉE de cette règle,
// pour cette paire précise, a déjà produit une tâche encore ouverte (ni terminée, ni annulée).
// L'exécution en cours de traitement (tacheId pas encore posé) est structurellement exclue par
// l'INNER JOIN sur taches — jamais un faux positif sur elle-même.
export async function existeExecutionAvecTacheOuvertePourPaire(
  regleCode: CodeRegleAutomatisation,
  bienId: string,
  acquereurId: string
): Promise<boolean> {
  const [ligne] = await getDb()
    .select({ id: executionsAutomatisation.id })
    .from(executionsAutomatisation)
    .innerJoin(evenementsMetier, eq(executionsAutomatisation.evenementId, evenementsMetier.id))
    .innerJoin(taches, eq(executionsAutomatisation.tacheId, taches.id))
    .where(
      and(
        eq(executionsAutomatisation.regleCode, regleCode),
        eq(evenementsMetier.bienId, bienId),
        eq(evenementsMetier.acquereurId, acquereurId),
        isNull(taches.termineeLe),
        isNull(taches.annuleeLe)
      )
    )
    .limit(1);
  return ligne !== undefined;
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
