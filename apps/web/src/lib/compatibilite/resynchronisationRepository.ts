import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { acquereurs as acquereursTable, compatibilitesARessynchroniser } from "@/db/schema";

type LigneDemande = typeof compatibilitesARessynchroniser.$inferSelect;

export type DemandeResynchronisation = {
  id: string;
  // ADR-054 — périmètre propriétaire de la demande, posé à l'enqueue. C'est lui qui suit jusqu'à
  // l'événement de compatibilité éventuellement émis pendant le traitement : le traitement n'a
  // ainsi besoin d'aucune session ni d'aucun contexte ambiant, y compris quand il est déclenché
  // par le balayage machine (/api/compatibilite/scan).
  workspaceId: string;
  bienId?: string;
  acquereurId?: string;
};

function ligneVersDemande(ligne: LigneDemande): DemandeResynchronisation {
  return {
    id: ligne.id,
    workspaceId: ligne.workspaceId,
    bienId: ligne.bienId ?? undefined,
    acquereurId: ligne.acquereurId ?? undefined,
  };
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
// ADR-054 — `workspaceId` obligatoire, fourni par l'appelant (contexte authentifié ou contexte
// d'exécution machine), jamais choisi ici. Le `set:` du DO UPDATE ne le touche volontairement pas :
// l'appartenance d'une demande en attente ne change jamais, seule sa date de demande est rafraîchie.
export async function enqueuerResynchronisationBien(
  bienId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<string> {
  const [ligne] = await executeur
    .insert(compatibilitesARessynchroniser)
    .values({ bienId, workspaceId })
    .onConflictDoUpdate({
      target: compatibilitesARessynchroniser.bienId,
      targetWhere: sql`${compatibilitesARessynchroniser.bienId} IS NOT NULL AND ${compatibilitesARessynchroniser.traiteeLe} IS NULL`,
      set: { demandeeLe: new Date() },
    })
    .returning({ id: compatibilitesARessynchroniser.id });
  return ligne.id;
}

export async function enqueuerResynchronisationAcquereur(
  acquereurId: string,
  workspaceId: string,
  executeur: Executeur
): Promise<string> {
  const [ligne] = await executeur
    .insert(compatibilitesARessynchroniser)
    .values({ acquereurId, workspaceId })
    .onConflictDoUpdate({
      target: compatibilitesARessynchroniser.acquereurId,
      targetWhere: sql`${compatibilitesARessynchroniser.acquereurId} IS NOT NULL AND ${compatibilitesARessynchroniser.traiteeLe} IS NULL`,
      set: { demandeeLe: new Date() },
    })
    .returning({ id: compatibilitesARessynchroniser.id });
  return ligne.id;
}

// ADR-036 + ADR-055 §B — invalidation déclenchée par une écriture sur le PROJET canonique, depuis
// que ce sont ses critères que le moteur lit (profilCompatibiliteRepository.ts). Sans elle, une
// mutation canonique (Sync Engine compris) changerait le résultat du matching sans que rien ne
// demande de le recalculer : les écrans continueraient d'afficher un statut périmé, et
// `compatibilites_bien_acquereur_etat` retiendrait une observation devenue fausse — silencieusement,
// donc bien pire qu'une erreur.
//
// La file existante est indexée par DOSSIER acquéreur, comme la mémoire technique et les
// événements : un changement de projet est donc traduit en autant de demandes que de dossiers qui
// pointent vers lui — aucun aujourd'hui pour un projet non rattaché (rien à invalider, aucune ligne
// insérée), un seul pour le flux de création actuel, et le jour où un projet en portera deux, les
// deux seront invalidés sans que ce code change.
//
// `workspaceId` n'est PAS un paramètre : il est lu sur le dossier lui-même. Ce n'est pas une
// entorse à ADR-054 mais son application — l'appartenance d'une ligne qui existe déjà est un fait,
// et laisser un appelant la proposer permettrait d'émettre l'événement de compatibilité dans un
// autre périmètre que celui de la paire.
//
// S'exécute sur l'`executeur` de l'appelant : l'enqueue est donc dans la même transaction que la
// mutation source exactement quand celle-ci en ouvre une, ce qu'exige le handoff durable ADR-036.
export async function enqueuerResynchronisationProjetAcquereur(
  projetAcquereurId: string,
  executeur: Executeur
): Promise<string[]> {
  const dossiers = await executeur
    .select({ id: acquereursTable.id, workspaceId: acquereursTable.workspaceId })
    .from(acquereursTable)
    .where(eq(acquereursTable.projetAcquereurId, projetAcquereurId));

  const idsDemandes: string[] = [];
  for (const dossier of dossiers) {
    idsDemandes.push(await enqueuerResynchronisationAcquereur(dossier.id, dossier.workspaceId, executeur));
  }
  return idsDemandes;
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
