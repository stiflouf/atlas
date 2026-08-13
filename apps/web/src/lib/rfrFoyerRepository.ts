import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rfrFoyer as rfrFoyerTable } from "@/db/schema";
import type { RfrFoyer } from "@/types/rfrFoyer";

type LigneRfrFoyer = typeof rfrFoyerTable.$inferSelect;

function ligneVersRfrFoyer(ligne: LigneRfrFoyer): RfrFoyer {
  return {
    id: ligne.id,
    dossierFiscalId: ligne.dossierFiscalId,
    anneeRfr: ligne.anneeRfr,
    rfrFoyerCentimes: ligne.rfrFoyerCentimes,
    nombrePartsCentiemes: ligne.nombrePartsCentiemes,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe?.toISOString() ?? undefined,
  };
}

export async function chargerRfrFoyer(dossierFiscalId: string): Promise<RfrFoyer[]> {
  const lignes = await getDb()
    .select()
    .from(rfrFoyerTable)
    .where(eq(rfrFoyerTable.dossierFiscalId, dossierFiscalId))
    .orderBy(rfrFoyerTable.anneeRfr);
  return lignes.map(ligneVersRfrFoyer);
}

// Upsert par (dossierFiscalId, anneeRfr) — même rationale que historique_amorcage : une donnée
// corrigible, pas un fait historisé.
export async function enregistrerRfrFoyer(
  dossierFiscalId: string,
  anneeRfr: number,
  rfrFoyerCentimes: number,
  nombrePartsCentiemes: number
): Promise<RfrFoyer> {
  const [ligne] = await getDb()
    .insert(rfrFoyerTable)
    .values({ dossierFiscalId, anneeRfr, rfrFoyerCentimes, nombrePartsCentiemes })
    .onConflictDoUpdate({
      target: [rfrFoyerTable.dossierFiscalId, rfrFoyerTable.anneeRfr],
      set: { rfrFoyerCentimes, nombrePartsCentiemes, modifieLe: new Date() },
    })
    .returning();
  return ligneVersRfrFoyer(ligne);
}
