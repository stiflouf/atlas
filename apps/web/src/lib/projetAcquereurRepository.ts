import { eq } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { projetsAcquereur as projetsAcquereurTable } from "@/db/schema";
import type { StadeProjet } from "@/types/client";
import type { ProjetAcquereur } from "@/types/projetAcquereur";

// ADR-055 §B — accès au projet acquéreur canonique. Les parties de projet vivent dans
// `partieProjetRepository.ts` depuis que les projets vendeur existent : la relation est partagée
// par les deux côtés, et la garder ici en ferait un vocabulaire acquéreur qu'elle n'est plus.

type LigneProjet = typeof projetsAcquereurTable.$inferSelect;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// NULL Postgres -> undefined métier, jamais false : un critère non documenté n'est pas un refus
// (même traduction que ligneVersAcquereur).
function ligneVersProjet(ligne: LigneProjet): ProjetAcquereur {
  return {
    id: ligne.id,
    budgetMin: ligne.budgetMin,
    budgetMax: ligne.budgetMax,
    criteres: ligne.criteres,
    stadeProjet: ligne.stadeProjet as StadeProjet,
    piecesMin: ligne.piecesMin ?? undefined,
    surfaceMin: ligne.surfaceMin ?? undefined,
    accessibiliteRequise: ligne.accessibiliteRequise ?? undefined,
    necessiteParking: ligne.necessiteParking ?? undefined,
    necessiteExterieur: ligne.necessiteExterieur ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
    archiveLe: ligne.archiveLe?.toISOString(),
  };
}

export type NouveauProjetAcquereur = Omit<ProjetAcquereur, "id" | "creeLe" | "archiveLe">;

// `workspaceId` est un paramètre OBLIGATOIRE (ADR-054) : il vient du contexte authentifié, jamais
// d'un littéral. `executeur` optionnel, même patron que `creerAcquereur`/`creerContact` : permet de
// créer le projet dans la même transaction que le contact et le dossier historique.
export async function creerProjetAcquereur(
  input: NouveauProjetAcquereur,
  workspaceId: string,
  executeur: Executeur = getDb()
): Promise<ProjetAcquereur> {
  const [ligne] = await executeur
    .insert(projetsAcquereurTable)
    .values({
      workspaceId,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      criteres: input.criteres,
      stadeProjet: input.stadeProjet,
      piecesMin: input.piecesMin ?? null,
      surfaceMin: input.surfaceMin ?? null,
      accessibiliteRequise: input.accessibiliteRequise ?? null,
      necessiteParking: input.necessiteParking ?? null,
      necessiteExterieur: input.necessiteExterieur ?? null,
    })
    .returning();
  return ligneVersProjet(ligne);
}

// Aucun filtrage par workspace en lecture : ce lot ne l'active pas (il reste un lot à part entière,
// pour pouvoir en caractériser les régressions séparément). Même choix que `getContactById`.
export async function getProjetAcquereurById(id: string): Promise<ProjetAcquereur | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .select()
    .from(projetsAcquereurTable)
    .where(eq(projetsAcquereurTable.id, id))
    .limit(1);
  return ligne ? ligneVersProjet(ligne) : undefined;
}
