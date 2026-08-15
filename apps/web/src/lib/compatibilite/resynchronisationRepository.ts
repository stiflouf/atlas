import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { compatibilitesARessynchroniser } from "@/db/schema";

type LigneDemande = typeof compatibilitesARessynchroniser.$inferSelect;

export type DemandeResynchronisation = {
  id: string;
  bienId?: string;
  acquereurId?: string;
};

function ligneVersDemande(ligne: LigneDemande): DemandeResynchronisation {
  return { id: ligne.id, bienId: ligne.bienId ?? undefined, acquereurId: ligne.acquereurId ?? undefined };
}

// Enqueue transactionnel du handoff durable (ADR-036) — DOIT être appelé DANS LA MÊME transaction
// que la mutation source, jamais après coup : c'est cette écriture, et elle seule, qui garantit
// qu'aucune mutation susceptible de changer une compatibilité ne peut être perdue entre son commit
// et le traitement effectif. Coalescing : tant qu'une ligne pour cette source reste non traitée
// (`traitee_le IS NULL`), une nouvelle demande la rafraîchit (`ON CONFLICT ... DO UPDATE`) plutôt
// que d'en empiler une nouvelle — le prédicat du DO UPDATE DOIT correspondre exactement à celui de
// l'index partiel visé (db/schema.ts), même exigence que emettreEvenementEtPreparerExecutions.
// Dès qu'une ligne est marquée traitée, elle sort de ce prédicat : une demande arrivée entre-temps
// ne peut donc jamais entrer en conflit avec une ligne déjà verrouillée par un traitement en cours
// ni être silencieusement absorbée par lui — elle crée naturellement une nouvelle ligne.
export async function enqueuerResynchronisationBien(bienId: string, executeur: Executeur): Promise<string> {
  const [ligne] = await executeur
    .insert(compatibilitesARessynchroniser)
    .values({ bienId })
    .onConflictDoUpdate({
      target: compatibilitesARessynchroniser.bienId,
      targetWhere: sql`${compatibilitesARessynchroniser.bienId} IS NOT NULL AND ${compatibilitesARessynchroniser.traiteeLe} IS NULL`,
      set: { demandeeLe: new Date() },
    })
    .returning({ id: compatibilitesARessynchroniser.id });
  return ligne.id;
}

export async function enqueuerResynchronisationAcquereur(acquereurId: string, executeur: Executeur): Promise<string> {
  const [ligne] = await executeur
    .insert(compatibilitesARessynchroniser)
    .values({ acquereurId })
    .onConflictDoUpdate({
      target: compatibilitesARessynchroniser.acquereurId,
      targetWhere: sql`${compatibilitesARessynchroniser.acquereurId} IS NOT NULL AND ${compatibilitesARessynchroniser.traiteeLe} IS NULL`,
      set: { demandeeLe: new Date() },
    })
    .returning({ id: compatibilitesARessynchroniser.id });
  return ligne.id;
}

// Verrouille UNE demande précise pour traitement — appelée aussi bien par le traitement immédiat
// après commit (id connu, retourné par l'enqueue) que par le balayage de reprise (id lu depuis
// listerDemandesEnAttente). Ne retourne rien si la ligne est déjà traitée ou verrouillée par un
// autre traitement concurrent : rien à faire, jamais un double traitement (même patron que
// verrouillerExecutionATraiter, automatisations/executionAutomatisationRepository.ts).
export async function verrouillerDemande(id: string, executeur: Executeur): Promise<DemandeResynchronisation | undefined> {
  const [ligne] = await executeur
    .select()
    .from(compatibilitesARessynchroniser)
    .where(and(eq(compatibilitesARessynchroniser.id, id), isNull(compatibilitesARessynchroniser.traiteeLe)))
    .for("update");
  return ligne ? ligneVersDemande(ligne) : undefined;
}

// Complétion par IDENTITÉ (id), jamais par source (bienId/acquereurId) — une complétion par source
// risquerait de marquer traitée une ligne insérée par une mutation concurrente survenue APRÈS le
// début de ce traitement (voir le commentaire de enqueuerResynchronisation* ci-dessus).
export async function marquerDemandeTraitee(id: string, executeur: Executeur): Promise<void> {
  await executeur
    .update(compatibilitesARessynchroniser)
    .set({ traiteeLe: new Date() })
    .where(and(eq(compatibilitesARessynchroniser.id, id), isNull(compatibilitesARessynchroniser.traiteeLe)));
}

// Échec JAMAIS terminal (contrairement à executions_automatisation.echoueeLe) : la ligne reste
// éligible au retraitement — un balayage ultérieur la reprendra. La correction (aucune transition
// perdue) prime sur toute notion de résolution définitive pour ce handoff technique.
export async function marquerDemandeEnEchec(id: string, erreurTechnique: string, executeur: Executeur = getDb()): Promise<void> {
  await executeur
    .update(compatibilitesARessynchroniser)
    .set({ derniereTentativeLe: new Date(), derniereErreur: erreurTechnique })
    .where(and(eq(compatibilitesARessynchroniser.id, id), isNull(compatibilitesARessynchroniser.traiteeLe)));
}

// Filet de reprise (/api/compatibilite/scan) : liste les demandes encore non traitées, les plus
// anciennes d'abord — aucun verrou ici (le verrou a lieu par ligne, au moment du traitement
// individuel), simple lecture pour construire le lot à traiter.
export async function listerDemandesEnAttente(limite = 200): Promise<DemandeResynchronisation[]> {
  const lignes = await getDb()
    .select()
    .from(compatibilitesARessynchroniser)
    .where(isNull(compatibilitesARessynchroniser.traiteeLe))
    .orderBy(compatibilitesARessynchroniser.demandeeLe)
    .limit(limite);
  return lignes.map(ligneVersDemande);
}
