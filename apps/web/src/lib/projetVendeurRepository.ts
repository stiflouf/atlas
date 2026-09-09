import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { projetsVendeur as projetsVendeurTable } from "@/db/schema";
import type { MotifPerteProspectVendeur } from "@/types/motifPerteProspectVendeur";
import type { OrigineLead } from "@/types/origineLead";
import type { ProjetVendeur } from "@/types/projetVendeur";

// ADR-055 §B — accès au projet vendeur canonique. Volontairement réduit à ce dont le lot a besoin :
// créer un projet et le relire. Aucun poseur de jalon, aucune fonction de perte ou d'archivage —
// ces gestes existent déjà sur `prospects_vendeurs`, qui reste la source de vérité du pipeline ;
// les dupliquer ici créerait deux chemins d'écriture pour le même fait.

type LigneProjet = typeof projetsVendeurTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais une chaîne vide ni un `false` : un jalon non atteint est
// absent, il n'a pas eu lieu à une date nulle (même traduction que ligneVersProspectVendeur).
function ligneVersProjet(ligne: LigneProjet): ProjetVendeur {
  return {
    id: ligne.id,
    origineLead: (ligne.origineLead as OrigineLead | null) ?? undefined,
    origineLeadDetail: ligne.origineLeadDetail ?? undefined,
    qualifieLe: ligne.qualifieLe?.toISOString(),
    rdvEstimationPrevuLe: ligne.rdvEstimationPrevuLe?.toISOString(),
    rdvEstimationRealiseLe: ligne.rdvEstimationRealiseLe?.toISOString(),
    estimationProposeeCentimes: ligne.estimationProposeeCentimes ?? undefined,
    estimationProposeeLe: ligne.estimationProposeeLe ?? undefined,
    mandatProposeLe: ligne.mandatProposeLe?.toISOString(),
    mandatSigneLe: ligne.mandatSigneLe?.toISOString(),
    motifPerte: (ligne.motifPerte as MotifPerteProspectVendeur | null) ?? undefined,
    datePerte: ligne.datePerte ?? undefined,
    dernierContactLe: ligne.dernierContactLe?.toISOString(),
    creeLe: ligne.creeLe.toISOString(),
    archiveLe: ligne.archiveLe?.toISOString(),
  };
}

// Seuls les champs saisissables à la création, exactement comme `NouveauProspectVendeur` : les
// jalons, l'issue commerciale et l'archivage sont posés ensuite par leur propre geste, jamais à la
// création (ADR-027).
export type NouveauProjetVendeur = Pick<ProjetVendeur, "origineLead" | "origineLeadDetail">;

// `workspaceId` est un paramètre OBLIGATOIRE (ADR-054) : il vient du contexte authentifié, jamais
// d'un littéral. `executeur` optionnel, même patron que les autres repositories : permet de créer le
// projet dans la même transaction que le contact et l'opportunité historique.
export async function creerProjetVendeur(
  input: NouveauProjetVendeur,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProjetVendeur> {
  const [ligne] = await executeur
    .insert(projetsVendeurTable)
    .values({
      workspaceId,
      origineLead: input.origineLead ?? null,
      origineLeadDetail: input.origineLeadDetail ?? null,
    })
    .returning();
  return ligneVersProjet(ligne);
}

// Aucun filtrage par workspace en lecture : ce lot ne l'active pas. Même choix que
// `getContactById` et `getProjetAcquereurById`.
export async function getProjetVendeurById(id: string): Promise<ProjetVendeur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb().select().from(projetsVendeurTable).where(eq(projetsVendeurTable.id, id)).limit(1);
  return ligne ? ligneVersProjet(ligne) : undefined;
}
