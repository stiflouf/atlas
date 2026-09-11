import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { runsScanAutomatisation } from "@/db/schema";
import type { CodeRegleAutomatisation, RunScanAutomatisation } from "@/types/automatisation";

function ligneVersRun(ligne: typeof runsScanAutomatisation.$inferSelect): RunScanAutomatisation {
  return {
    id: ligne.id,
    regleCode: ligne.regleCode as CodeRegleAutomatisation,
    demarreLe: ligne.demarreLe.toISOString(),
    termineLe: ligne.termineLe?.toISOString(),
    nombreCandidats: ligne.nombreCandidats ?? undefined,
    nombreOccurrencesCreees: ligne.nombreOccurrencesCreees ?? undefined,
    erreurTechnique: ligne.erreurTechnique ?? undefined,
  };
}

// Journal technique à mutation contrôlée (ADR-033) — jamais append-only strict : une ligne est
// posée ici au tout début du scan, puis complétée par terminerRunScanAutomatisation() une fois
// terminé. Un run resté sans `termineLe` (crash pendant le scan) reste honnêtement visible comme
// "en_cours" — voir deriverEtatRunScanAutomatisation.
export async function demarrerRunScanAutomatisation(
  regleCode: CodeRegleAutomatisation,
  workspaceId: string
): Promise<string> {
  const [ligne] = await getDb()
    .insert(runsScanAutomatisation)
    .values({ regleCode, workspaceId })
    .returning({ id: runsScanAutomatisation.id });
  return ligne.id;
}

// Complète le run (succès : compteurs seuls ; échec : compteurs partiels + erreurTechnique).
// Jamais appelée deux fois pour le même id en pratique (un seul scan par run) — pas de gel
// concurrent nécessaire ici, contrairement à executions_automatisation qui peut être retraitée.
export async function terminerRunScanAutomatisation(
  id: string,
  resultat: { nombreCandidats: number; nombreOccurrencesCreees: number; erreurTechnique?: string }
): Promise<void> {
  await getDb()
    .update(runsScanAutomatisation)
    .set({
      termineLe: new Date(),
      nombreCandidats: resultat.nombreCandidats,
      nombreOccurrencesCreees: resultat.nombreOccurrencesCreees,
      erreurTechnique: resultat.erreurTechnique ?? null,
    })
    .where(eq(runsScanAutomatisation.id, id));
}

// LE DERNIER RUN = le `demarreLe` le plus récent ; à égalité, le `ordre` le plus grand.
//
// Deux runs PEUVENT partager exactement le même `demarreLe` : c'est `now()`, donc le
// `transaction_timestamp()` à la microseconde, et deux scans concurrents (l'endpoint n'a aucun
// verrou, ADR-033) démarrent à quelques centaines de microsecondes l'un de l'autre — mesuré à
// 344 µs sur cette base. La collision est rare, jamais impossible.
//
// Le tie-break précédent était `id DESC`. Il rendait bien la sélection déterministe, mais sur un
// uuid aléatoire : à égalité de timestamp, c'était le plus grand uuid qui gagnait, pas le run
// réellement démarré en dernier. Déterministe et faux est le pire des deux mondes — la valeur ne
// bouge pas, donc rien ne signale l'erreur. `ordre` est une séquence allouée à l'INSERT : elle dit
// l'ordre réel des démarrages, et donne au journal l'ordre TOTAL que `demarreLe` seul n'a pas.
//
// `demarreLe` reste le critère PRINCIPAL : c'est lui qui porte le sens métier (« quand ce scan
// a-t-il démarré »), `ordre` ne fait que trancher ce qu'il ne sait pas trancher.
export async function getDernierRunScanPourRegle(regleCode: CodeRegleAutomatisation): Promise<RunScanAutomatisation | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(runsScanAutomatisation)
    .where(eq(runsScanAutomatisation.regleCode, regleCode))
    .orderBy(desc(runsScanAutomatisation.demarreLe), desc(runsScanAutomatisation.ordre))
    .limit(1);
  return ligne ? ligneVersRun(ligne) : undefined;
}
