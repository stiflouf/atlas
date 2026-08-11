import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { notesBien as notesBienTable } from "@/db/schema";
import type { NoteBien } from "@/types/noteBien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneNoteBien = typeof notesBienTable.$inferSelect;

function ligneVersNoteBien(ligne: LigneNoteBien): NoteBien {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    contenu: ligne.contenu,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Pas de repli mock : une note n'existe que pour un bien réel (colonne bienId en FK uuid), il
// n'y a pas de dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien mocké) ne
// peut correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerNotesPourBien(bienId: string): Promise<NoteBien[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(notesBienTable)
      .where(eq(notesBienTable.bienId, bienId))
      .orderBy(desc(notesBienTable.creeLe));
    return lignes.map(ligneVersNoteBien);
  } catch (erreur) {
    console.error("[notes-bien] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Validation (contenu non vide après trim) déjà faite par l'appelant (server action) — insertion
// pure ici, même principe que les autres repositories.
export async function ajouterNoteBien(bienId: string, contenu: string): Promise<NoteBien> {
  const [ligne] = await getDb().insert(notesBienTable).values({ bienId, contenu }).returning();
  return ligneVersNoteBien(ligne);
}
