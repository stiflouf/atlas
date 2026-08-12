import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { offres as offresTable } from "@/db/schema";
import type { Offre, StatutOffre } from "@/types/offre";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneOffre = typeof offresTable.$inferSelect;

function ligneVersOffre(ligne: LigneOffre): Offre {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    acquereurId: ligne.acquereurId,
    montant: ligne.montant,
    dateOffre: ligne.dateOffre,
    statut: ligne.statut as StatutOffre,
    dateValidite: ligne.dateValidite ?? undefined,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Pas de repli mock : une offre n'existe que pour un bien/acquéreur réels (FK uuid), il n'y a pas
// de dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien/acquéreur mocké) ne
// peut correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerOffresPourBien(bienId: string): Promise<Offre[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(offresTable)
      .where(eq(offresTable.bienId, bienId))
      .orderBy(desc(offresTable.dateOffre));
    return lignes.map(ligneVersOffre);
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return [];
  }
}

export async function listerOffresPourAcquereur(acquereurId: string): Promise<Offre[]> {
  if (!UUID_REGEX.test(acquereurId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(offresTable)
      .where(eq(offresTable.acquereurId, acquereurId))
      .orderBy(desc(offresTable.dateOffre));
    return lignes.map(ligneVersOffre);
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution directe, jamais filtrée par archivage — nécessaire pour que changerStatutOffreAction
// retrouve le bien/acquéreur d'une offre avant de vérifier leur statut d'archivage.
export async function getOffreById(id: string): Promise<Offre | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await getDb().select().from(offresTable).where(eq(offresTable.id, id));
    return ligne ? ligneVersOffre(ligne) : undefined;
  } catch (erreur) {
    console.error("[offres] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// Validation (montant > 0, bien/acquéreur non archivés) déjà faite par l'appelant (server
// action) — insertion pure ici, même principe que les autres repositories.
export type NouvelleOffre = Omit<Offre, "id" | "statut" | "creeLe">;

export async function enregistrerOffre(input: NouvelleOffre): Promise<Offre> {
  const [ligne] = await getDb()
    .insert(offresTable)
    .values({
      bienId: input.bienId,
      acquereurId: input.acquereurId,
      montant: input.montant,
      dateOffre: input.dateOffre,
      dateValidite: input.dateValidite ?? null,
    })
    .returning();
  return ligneVersOffre(ligne);
}

// UPDATE pur du statut uniquement — aucune garde métier interne (transitions autorisées,
// archivage) : même séparation que bienRepository, la garde vit dans la Server Action.
export async function changerStatutOffre(id: string, statut: StatutOffre): Promise<Offre | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  const [ligne] = await getDb()
    .update(offresTable)
    .set({ statut })
    .where(eq(offresTable.id, id))
    .returning();
  return ligne ? ligneVersOffre(ligne) : undefined;
}
