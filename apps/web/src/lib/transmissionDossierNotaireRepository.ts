import { desc, eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { transmissionsDossierNotaire as transmissionsTable } from "@/db/schema";
import type { ManifesteSnapshot, NouvelleTransmissionDossierNotaire, TransmissionDossierNotaire } from "@/types/transmissionDossierNotaire";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneTransmission = typeof transmissionsTable.$inferSelect;

function ligneVersTransmission(ligne: LigneTransmission): TransmissionDossierNotaire {
  return {
    id: ligne.id,
    compromisId: ligne.compromisId,
    cleIdempotence: ligne.cleIdempotence,
    etudeNom: ligne.etudeNom,
    destinataireNom: ligne.destinataireNom ?? undefined,
    destinataireEmail: ligne.destinataireEmail ?? undefined,
    transmisLe: ligne.transmisLe.toISOString(),
    creeParEmail: ligne.creeParEmail,
    manifesteVersion: ligne.manifesteVersion,
    manifesteSnapshot: ligne.manifesteSnapshot as ManifesteSnapshot,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// `ON CONFLICT (cle_idempotence) DO NOTHING` — même mécanisme que envoisEmail.demarrerTentativeEnvoi,
// adapté à une mutation pure DB (pas de tentative réseau à distinguer, ADR-049 §9) : si une ligne
// existe déjà pour cette clé (double submit), retourne `undefined` SANS RIEN ÉCRIRE — l'appelant
// relit alors l'état existant (getTransmissionParCleIdempotence) plutôt que de dupliquer la
// transmission. Une nouvelle transmission légitime plus tard utilise une nouvelle clé : jamais
// déduite de compromisId+documents+destinataire, qui peuvent légitimement se répéter.
export async function enregistrerTransmission(
  input: NouvelleTransmissionDossierNotaire,
  executeur: Executeur = getDb()
): Promise<TransmissionDossierNotaire | undefined> {
  const [ligne] = await executeur
    .insert(transmissionsTable)
    .values({
      compromisId: input.compromisId,
      cleIdempotence: input.cleIdempotence,
      etudeNom: input.etudeNom,
      destinataireNom: input.destinataireNom ?? null,
      destinataireEmail: input.destinataireEmail ?? null,
      transmisLe: new Date(input.transmisLe),
      creeParEmail: input.creeParEmail,
      manifesteVersion: input.manifesteVersion ?? 1,
      manifesteSnapshot: input.manifesteSnapshot,
    })
    .onConflictDoNothing({ target: transmissionsTable.cleIdempotence })
    .returning();
  return ligne ? ligneVersTransmission(ligne) : undefined;
}

export async function getTransmissionParCleIdempotence(cleIdempotence: string): Promise<TransmissionDossierNotaire | undefined> {
  if (!UUID_REGEX.test(cleIdempotence)) return undefined;
  const [ligne] = await getDb().select().from(transmissionsTable).where(eq(transmissionsTable.cleIdempotence, cleIdempotence)).limit(1);
  return ligne ? ligneVersTransmission(ligne) : undefined;
}

// Historique complet — jamais filtré, jamais recalculé (ADR-049 §37). Tri déterministe :
// transmisLe (fait métier) d'abord, id en tie-break explicite (jamais un numéro de version mutable).
export async function listerTransmissionsPourCompromis(compromisId: string): Promise<TransmissionDossierNotaire[]> {
  if (!UUID_REGEX.test(compromisId)) return [];
  const lignes = await getDb()
    .select()
    .from(transmissionsTable)
    .where(eq(transmissionsTable.compromisId, compromisId))
    .orderBy(desc(transmissionsTable.transmisLe), desc(transmissionsTable.id));
  return lignes.map(ligneVersTransmission);
}
