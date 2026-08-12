import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { compromis as compromisTable, remuneration as remunerationTable } from "@/db/schema";
import type { ChampsCorrectionRemuneration, NouvelleRemuneration, Remuneration } from "@/types/remuneration";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneRemuneration = typeof remunerationTable.$inferSelect;

function ligneVersRemuneration(ligne: LigneRemuneration): Remuneration {
  return {
    id: ligne.id,
    compromisId: ligne.compromisId,
    montantHonorairesTotalCentimes: ligne.montantHonorairesTotalCentimes ?? undefined,
    montantRemunerationConseillerCentimes: ligne.montantRemunerationConseillerCentimes,
    dateEncaissementPrevue: ligne.dateEncaissementPrevue ?? undefined,
    dateEncaissementReelle: ligne.dateEncaissementReelle ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe?.toISOString() ?? undefined,
  };
}

// Pas de repli mock, même rationale que compromisRepository : une rémunération n'existe que pour un
// compromis réel (FK uuid).
export async function listerRemunerationsPourBien(bienId: string): Promise<Remuneration[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select({ remuneration: remunerationTable })
      .from(remunerationTable)
      .innerJoin(compromisTable, eq(remunerationTable.compromisId, compromisTable.id))
      .where(eq(compromisTable.bienId, bienId));
    return lignes.map((l) => ligneVersRemuneration(l.remuneration));
  } catch (erreur) {
    console.error("[remuneration] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution principale (1:1), non filtrée par archivage — nécessaire pour que les Server Actions
// retrouvent la rémunération avant de vérifier l'archivage du bien/acquéreur lié au compromis.
export async function getRemunerationParCompromis(compromisId: string): Promise<Remuneration | undefined> {
  if (!UUID_REGEX.test(compromisId)) return undefined;
  try {
    const [ligne] = await getDb()
      .select()
      .from(remunerationTable)
      .where(eq(remunerationTable.compromisId, compromisId));
    return ligne ? ligneVersRemuneration(ligne) : undefined;
  } catch (erreur) {
    console.error("[remuneration] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// Validation (compromis non annulé, archivage, absence de doublon) déjà faite par l'appelant (Server
// Action) — insertion pure ici. L'unicité compromisId est garantie par la contrainte UNIQUE en base
// (doublon ⇒ erreur Postgres remontée telle quelle, pas de garde applicative dupliquée).
export async function enregistrerRemuneration(input: NouvelleRemuneration): Promise<Remuneration> {
  const [ligne] = await getDb()
    .insert(remunerationTable)
    .values({
      compromisId: input.compromisId,
      montantHonorairesTotalCentimes: input.montantHonorairesTotalCentimes ?? null,
      montantRemunerationConseillerCentimes: input.montantRemunerationConseillerCentimes,
      dateEncaissementPrevue: input.dateEncaissementPrevue ?? null,
    })
    .returning();
  return ligneVersRemuneration(ligne);
}

// Remplacement complet des trois colonnes corrigibles (null écrit explicitement NULL en base) —
// jamais un patch partiel. Gel concurrent : la clause WHERE ... date_encaissement_reelle IS NULL
// fait échouer l'écriture (0 ligne) si un encaissement a été posé entre la lecture et l'écriture par
// l'appelant — retourne undefined dans ce cas, jamais une valeur silencieusement inchangée.
export async function modifierRemunerationPrevisionnelle(
  compromisId: string,
  champs: ChampsCorrectionRemuneration
): Promise<Remuneration | undefined> {
  if (!UUID_REGEX.test(compromisId)) return undefined;
  const [ligne] = await getDb()
    .update(remunerationTable)
    .set({
      montantRemunerationConseillerCentimes: champs.montantRemunerationConseillerCentimes,
      montantHonorairesTotalCentimes: champs.montantHonorairesTotalCentimes,
      dateEncaissementPrevue: champs.dateEncaissementPrevue,
      modifieLe: new Date(),
    })
    .where(and(eq(remunerationTable.compromisId, compromisId), isNull(remunerationTable.dateEncaissementReelle)))
    .returning();
  return ligne ? ligneVersRemuneration(ligne) : undefined;
}

// Écriture atomique dédiée à la transition d'encaissement (ADR-021, même patron que
// marquerCompromisRealise) : dateEncaissementReelle posée en une seule UPDATE, protégée par la même
// garde de gel concurrent que modifierRemunerationPrevisionnelle. La règle cross-table
// (compromis.statut === 'realise' et dateActeReelle présente) n'est pas vérifiée ici — elle est
// entièrement portée par marquerRemunerationEncaisseeAction (src/actions/remuneration.ts), même
// séparation que le reste du codebase (ADR-020).
export async function marquerRemunerationEncaissee(
  compromisId: string,
  dateEncaissementReelle: string
): Promise<Remuneration | undefined> {
  if (!UUID_REGEX.test(compromisId)) return undefined;
  const [ligne] = await getDb()
    .update(remunerationTable)
    .set({ dateEncaissementReelle })
    .where(and(eq(remunerationTable.compromisId, compromisId), isNull(remunerationTable.dateEncaissementReelle)))
    .returning();
  return ligne ? ligneVersRemuneration(ligne) : undefined;
}
