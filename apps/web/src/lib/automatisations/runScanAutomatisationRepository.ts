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
export async function demarrerRunScanAutomatisation(regleCode: CodeRegleAutomatisation): Promise<string> {
  const [ligne] = await getDb().insert(runsScanAutomatisation).values({ regleCode }).returning({ id: runsScanAutomatisation.id });
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

// Tie-break sur `id` (uuid aléatoire, sans signification chronologique) : deux runs peuvent
// partager le même `demarreLe` (defaultNow() à la milliseconde, deux inserts rapprochés) — sans ce
// second critère, `ORDER BY demarreLe DESC LIMIT 1` devient non déterministe entre égalités. Le
// rôle de ce tie-break est uniquement de rendre la sélection déterministe, jamais de représenter un
// ordre temporel supplémentaire (audit V1 Candidate, classe de flakiness scanTemporel.test.ts).
export async function getDernierRunScanPourRegle(regleCode: CodeRegleAutomatisation): Promise<RunScanAutomatisation | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(runsScanAutomatisation)
    .where(eq(runsScanAutomatisation.regleCode, regleCode))
    .orderBy(desc(runsScanAutomatisation.demarreLe), desc(runsScanAutomatisation.id))
    .limit(1);
  return ligne ? ligneVersRun(ligne) : undefined;
}
