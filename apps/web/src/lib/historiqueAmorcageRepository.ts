import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { historiqueAmorcage as historiqueAmorcageTable } from "@/db/schema";
import type { CouvertureAnnuelle, HistoriqueAmorcage } from "@/types/historiqueAmorcage";

type LigneHistoriqueAmorcage = typeof historiqueAmorcageTable.$inferSelect;

function ligneVersHistorique(ligne: LigneHistoriqueAmorcage): HistoriqueAmorcage {
  return {
    id: ligne.id,
    dossierFiscalId: ligne.dossierFiscalId,
    annee: ligne.annee,
    montantEncaisseCentimes: ligne.montantEncaisseCentimes,
    dateFinCouverture: ligne.dateFinCouverture,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe?.toISOString() ?? undefined,
  };
}

export async function chargerHistoriqueAmorcage(dossierFiscalId: string): Promise<HistoriqueAmorcage[]> {
  const lignes = await getDb()
    .select()
    .from(historiqueAmorcageTable)
    .where(eq(historiqueAmorcageTable.dossierFiscalId, dossierFiscalId))
    .orderBy(historiqueAmorcageTable.annee);
  return lignes.map(ligneVersHistorique);
}

// Contrat du futur résolveur (ADR-024, point 3) : absence de ligne pour cette année = couverture
// antérieure inconnue, jamais assimilée à 0. Une ligne avec montantEncaisseCentimes = 0 est un
// zéro confirmé explicitement — les deux cas sont distingués par le type retour (connu: false vs
// connu: true), jamais par une valeur numérique par défaut.
export async function chargerCouvertureAnnee(dossierFiscalId: string, annee: number): Promise<CouvertureAnnuelle> {
  const [ligne] = await getDb()
    .select()
    .from(historiqueAmorcageTable)
    .where(and(eq(historiqueAmorcageTable.dossierFiscalId, dossierFiscalId), eq(historiqueAmorcageTable.annee, annee)));
  if (!ligne) return { annee, connu: false };
  return {
    annee,
    connu: true,
    montantEncaisseCentimes: ligne.montantEncaisseCentimes,
    dateFinCouverture: ligne.dateFinCouverture,
  };
}

// Upsert par (dossierFiscalId, annee) — contrairement à profil_fiscal, ce n'est pas un fait
// historisé mais une estimation d'amorçage corrigible : une nouvelle saisie remplace la ligne
// existante pour la même année plutôt que d'en empiler une nouvelle.
export async function enregistrerHistoriqueAmorcage(
  dossierFiscalId: string,
  annee: number,
  montantEncaisseCentimes: number,
  dateFinCouverture: string
): Promise<HistoriqueAmorcage> {
  const [ligne] = await getDb()
    .insert(historiqueAmorcageTable)
    .values({ dossierFiscalId, annee, montantEncaisseCentimes, dateFinCouverture })
    .onConflictDoUpdate({
      target: [historiqueAmorcageTable.dossierFiscalId, historiqueAmorcageTable.annee],
      set: { montantEncaisseCentimes, dateFinCouverture, modifieLe: new Date() },
    })
    .returning();
  return ligneVersHistorique(ligne);
}
