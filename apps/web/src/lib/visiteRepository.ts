import { and, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { visites as visitesTable } from "@/db/schema";
import type { Visite, StatutVisite } from "@/types/visite";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneVisite = typeof visitesTable.$inferSelect;

function ligneVersVisite(ligne: LigneVisite): Visite {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    datePrevue: ligne.datePrevue,
    statut: ligne.statut as StatutVisite,
    rendezVousCalendarId: ligne.rendezVousCalendarId,
    creeLe: ligne.creeLe.toISOString(),
  };
}

export async function getVisiteById(id: string): Promise<Visite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(visitesTable).where(eq(visitesTable.id, id));
  return ligne ? ligneVersVisite(ligne) : undefined;
}

export async function getVisiteParRendezVousCalendarId(rendezVousCalendarId: string): Promise<Visite | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(visitesTable)
    .where(eq(visitesTable.rendezVousCalendarId, rendezVousCalendarId));
  return ligne ? ligneVersVisite(ligne) : undefined;
}

export async function listerVisitesPourBien(bienId: string): Promise<Visite[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await getDb().select().from(visitesTable).where(eq(visitesTable.bienId, bienId));
  return lignes.map(ligneVersVisite);
}

// Signal exploité par la règle nouveau_match_bien_acquereur (ADR-037/040) : seule une visite
// encore 'planifiee' rend l'action redondante — une visite 'realisee' ou 'annulee' ne doit jamais
// bloquer indéfiniment un futur cycle de compatibilité légitime (même rationale que
// offre/compromis déjà en place dans cette règle).
export async function existeVisitePlanifieePourPaire(bienId: string, acquereurId: string): Promise<boolean> {
  if (!UUID_REGEX.test(bienId) || !UUID_REGEX.test(acquereurId)) return false;
  const [ligne] = await getDb()
    .select({ id: visitesTable.id })
    .from(visitesTable)
    .where(
      and(
        eq(visitesTable.bienId, bienId),
        eq(visitesTable.acquereurId, acquereurId),
        eq(visitesTable.statut, "planifiee")
      )
    )
    .limit(1);
  return !!ligne;
}

export type NouvelleVisite = { bienId: string; acquereurId: string; datePrevue: string; rendezVousCalendarId: string };

// Matérialisation idempotente (ADR-040, correction n°7/35) : garantie posée au niveau DB
// (UNIQUE sur rendez_vous_calendar_id), jamais uniquement un find-before-insert applicatif —
// deux appels concurrents pour le même rendez-vous Calendar (double clic, double onglet) ne
// créent jamais deux lignes. `onConflictDoNothing` puis relecture si le conflit a bien eu lieu
// (aucune ligne retournée par l'insert).
export async function materialiserVisite(input: NouvelleVisite, executeur: Executeur = getDb()): Promise<Visite> {
  const [ligneInseree] = await executeur
    .insert(visitesTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      datePrevue: input.datePrevue,
      rendezVousCalendarId: input.rendezVousCalendarId,
    })
    .onConflictDoNothing({ target: visitesTable.rendezVousCalendarId })
    .returning();
  if (ligneInseree) return ligneVersVisite(ligneInseree);

  const existante = await getVisiteParRendezVousCalendarId(input.rendezVousCalendarId);
  if (!existante) {
    throw new Error("Échec de matérialisation de la visite : ni insertion ni ligne existante retrouvée.");
  }
  return existante;
}

// Écriture atomique dédiée (même patron que terminerTache/marquerOffreEnCours) : la clause WHERE
// fait échouer l'UPDATE (0 ligne, retour undefined) plutôt que d'écraser silencieusement une
// visite déjà réalisée ou annulée — jamais une seconde transition depuis un état terminal.
export async function marquerVisiteRealisee(id: string, executeur: Executeur = getDb()): Promise<Visite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await executeur
    .update(visitesTable)
    .set({ statut: "realisee" })
    .where(and(eq(visitesTable.id, id), eq(visitesTable.statut, "planifiee")))
    .returning();
  return ligne ? ligneVersVisite(ligne) : undefined;
}

export async function annulerVisite(id: string): Promise<Visite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(visitesTable)
    .set({ statut: "annulee" })
    .where(and(eq(visitesTable.id, id), eq(visitesTable.statut, "planifiee")))
    .returning();
  return ligne ? ligneVersVisite(ligne) : undefined;
}

// Report (ADR-040, §11) : même visite, même id — jamais annulée+recréée. Restreint aux visites
// encore 'planifiee' : reporter une visite déjà réalisée ou annulée n'a pas de sens métier.
export async function modifierDatePrevueVisite(id: string, nouvelleDatePrevue: string): Promise<Visite | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(visitesTable)
    .set({ datePrevue: nouvelleDatePrevue })
    .where(and(eq(visitesTable.id, id), eq(visitesTable.statut, "planifiee")))
    .returning();
  return ligne ? ligneVersVisite(ligne) : undefined;
}
