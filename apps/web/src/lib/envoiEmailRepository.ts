import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { envoisEmail as envoisEmailTable } from "@/db/schema";
import type { IntentionCommunication } from "@/lib/communications/contexteCommunication";
import type { EnvoiEmail } from "@/types/envoiEmail";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneEnvoiEmail = typeof envoisEmailTable.$inferSelect;

function ligneVersEnvoiEmail(ligne: LigneEnvoiEmail): EnvoiEmail {
  return {
    id: ligne.id,
    destinataireEmail: ligne.destinataireEmail,
    objet: ligne.objet,
    contenuHash: ligne.contenuHash,
    fournisseur: ligne.fournisseur,
    bienId: ligne.bienId ?? undefined,
    tacheId: ligne.tacheId ?? undefined,
    origineIntention: (ligne.origineIntention as IntentionCommunication | null) ?? undefined,
    gmailMessageId: ligne.gmailMessageId ?? undefined,
    demarreLe: ligne.demarreLe.toISOString(),
    reussiLe: ligne.reussiLe?.toISOString(),
    echoueLe: ligne.echoueLe?.toISOString(),
    incertainLe: ligne.incertainLe?.toISOString(),
    erreurTechnique: ligne.erreurTechnique ?? undefined,
  };
}

// Empreinte technique de diagnostic UNIQUEMENT (ADR-031-bis) — jamais utilisée pour bloquer un
// envoi (contrairement à une fenêtre de temps arbitraire, écartée explicitement), jamais un fait
// CRM. Le corps complet, lui, n'est jamais persisté par ailleurs.
export function calculerContenuHash(destinataireEmail: string, objet: string, corps: string): string {
  return createHash("sha256").update(`${destinataireEmail}\n${objet}\n${corps}`, "utf8").digest("hex");
}

export type NouvelEnvoiEmail = {
  id: string; // Clé d'idempotence fournie par l'appelant — jamais générée ici (defaultRandom absent du schéma).
  destinataireEmail: string;
  objet: string;
  contenuHash: string;
  bienId?: string;
  tacheId?: string;
  origineIntention?: IntentionCommunication;
};

// Démarre une tentative d'envoi — `ON CONFLICT (id) DO NOTHING` : si une ligne existe déjà pour
// cette clé (double clic, retry réseau, resoumission du même formulaire), retourne `undefined`
// SANS RIEN ÉCRIRE — l'appelant doit alors relire l'état existant (getEnvoiEmailById) plutôt que
// de démarrer un nouvel appel Gmail. C'est tout le mécanisme d'idempotence (ADR-031-bis) : aucune
// fenêtre de temps, aucune heuristique de contenu, uniquement une clé.
export async function demarrerTentativeEnvoi(input: NouvelEnvoiEmail): Promise<EnvoiEmail | undefined> {
  const [ligne] = await getDb()
    .insert(envoisEmailTable)
    .values({
      id: input.id,
      destinataireEmail: input.destinataireEmail,
      objet: input.objet,
      contenuHash: input.contenuHash,
      bienId: input.bienId ?? null,
      tacheId: input.tacheId ?? null,
      origineIntention: input.origineIntention ?? null,
    })
    .onConflictDoNothing({ target: envoisEmailTable.id })
    .returning();
  return ligne ? ligneVersEnvoiEmail(ligne) : undefined;
}

export async function getEnvoiEmailById(id: string): Promise<EnvoiEmail | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(envoisEmailTable).where(eq(envoisEmailTable.id, id)).limit(1);
  return ligne ? ligneVersEnvoiEmail(ligne) : undefined;
}

// Gel concurrent identique aux trois transitions (même patron que marquerCompromisRealise/
// terminerTache) : la clause WHERE ... IS NULL sur les trois timestamps garantit qu'une ligne déjà
// résolue (succès, échec ou incertain) ne peut plus jamais être réécrite — retourne `undefined`
// plutôt qu'un écrasement silencieux.
async function resoudreTentative(
  id: string,
  colonne: "reussiLe" | "echoueLe" | "incertainLe",
  valeurs: Record<string, unknown>
): Promise<EnvoiEmail | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(envoisEmailTable)
    .set(valeurs)
    .where(
      and(
        eq(envoisEmailTable.id, id),
        isNull(envoisEmailTable.reussiLe),
        isNull(envoisEmailTable.echoueLe),
        isNull(envoisEmailTable.incertainLe)
      )
    )
    .returning();
  return ligne ? ligneVersEnvoiEmail(ligne) : undefined;
}

export async function marquerEnvoiReussi(id: string, gmailMessageId: string): Promise<EnvoiEmail | undefined> {
  return resoudreTentative(id, "reussiLe", { reussiLe: new Date(), gmailMessageId });
}

export async function marquerEnvoiEchoue(id: string, erreurTechnique: string): Promise<EnvoiEmail | undefined> {
  return resoudreTentative(id, "echoueLe", { echoueLe: new Date(), erreurTechnique });
}

export async function marquerEnvoiIncertain(id: string, erreurTechnique: string): Promise<EnvoiEmail | undefined> {
  return resoudreTentative(id, "incertainLe", { incertainLe: new Date(), erreurTechnique });
}
