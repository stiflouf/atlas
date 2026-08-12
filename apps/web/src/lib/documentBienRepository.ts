import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentsBien as documentsBienTable } from "@/db/schema";
import type { CategorieDocument, DocumentBien } from "@/types/documentBien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneDocumentBien = typeof documentsBienTable.$inferSelect;

function ligneVersDocumentBien(ligne: LigneDocumentBien): DocumentBien {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    nom: ligne.nom,
    categorie: ligne.categorie as CategorieDocument,
    nomFichierOriginal: ligne.nomFichierOriginal,
    cleStockage: ligne.cleStockage,
    tailleOctets: ligne.tailleOctets,
    typeMime: ligne.typeMime,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Pas de repli mock : un document n'existe que pour un bien réel (FK uuid), il n'y a pas de
// dataset de démonstration équivalent à fabriquer. Un id non-UUID (bien mocké) ne peut
// correspondre à aucune ligne réelle : liste vide plutôt qu'une erreur de cast Postgres.
export async function listerDocumentsPourBien(bienId: string): Promise<DocumentBien[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  try {
    const lignes = await getDb()
      .select()
      .from(documentsBienTable)
      .where(eq(documentsBienTable.bienId, bienId))
      .orderBy(desc(documentsBienTable.creeLe));
    return lignes.map(ligneVersDocumentBien);
  } catch (erreur) {
    console.error("[documents-bien] lecture Postgres indisponible :", erreur);
    return [];
  }
}

// Résolution directe par id, utilisée par le Route Handler de téléchargement — continue de
// résoudre un document même si le bien associé a depuis été archivé (ADR-012), jamais si le bien
// mocké n'a pas d'id UUID.
export async function getDocumentBienById(id: string): Promise<DocumentBien | undefined> {
  if (!UUID_REGEX.test(id)) return undefined;
  try {
    const [ligne] = await getDb().select().from(documentsBienTable).where(eq(documentsBienTable.id, id));
    return ligne ? ligneVersDocumentBien(ligne) : undefined;
  } catch (erreur) {
    console.error("[documents-bien] lecture Postgres indisponible :", erreur);
    return undefined;
  }
}

// Validation (nom non vide, type MIME et taille contrôlés, bien non archivé) déjà faite par
// l'appelant (server action), écriture du fichier sur disque déjà faite avant cet appel
// (src/lib/stockageDocuments.ts) — insertion pure ici, même principe que les autres repositories.
export type NouveauDocumentBien = Omit<DocumentBien, "id" | "creeLe">;

export async function enregistrerDocumentBien(input: NouveauDocumentBien): Promise<DocumentBien> {
  const [ligne] = await getDb()
    .insert(documentsBienTable)
    .values({
      bienId: input.bienId,
      nom: input.nom,
      categorie: input.categorie,
      nomFichierOriginal: input.nomFichierOriginal,
      cleStockage: input.cleStockage,
      tailleOctets: input.tailleOctets,
      typeMime: input.typeMime,
    })
    .returning();
  return ligneVersDocumentBien(ligne);
}
