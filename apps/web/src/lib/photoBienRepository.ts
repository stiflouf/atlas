import { count, eq, sql } from "drizzle-orm";
import { getDb, type Executeur } from "@/db/client";
import { biens as biensTable, photosBien as photosBienTable } from "@/db/schema";
import type { PhotoBien } from "@/types/photoBien";
import { NOMBRE_MAX_PHOTOS_PAR_BIEN } from "@/types/photoBien";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LignePhotoBien = typeof photosBienTable.$inferSelect;

function ligneVersPhotoBien(ligne: LignePhotoBien): PhotoBien {
  return {
    id: ligne.id,
    bienId: ligne.bienId,
    cleStockage: ligne.cleStockage,
    nomFichierOriginal: ligne.nomFichierOriginal,
    typeMimeOriginal: ligne.typeMimeOriginal,
    tailleOctetsOriginal: ligne.tailleOctetsOriginal,
    hashSha256: ligne.hashSha256,
    ordre: ligne.ordre,
    creeLe: ligne.creeLe.toISOString(),
  };
}

// Tri total unique (ADR-052 §5/§7) : utilisé identiquement par la galerie et par la résolution de
// la photo principale (LIMIT 1 dessus) — `id` en dernier départage garantit un ordre déterministe
// même en cas de collision d'`ordre` (colonne volontairement non unique, voir schema.ts).
export async function listerPhotosBien(bienId: string): Promise<PhotoBien[]> {
  if (!UUID_REGEX.test(bienId)) return [];
  const lignes = await getDb()
    .select()
    .from(photosBienTable)
    .where(eq(photosBienTable.bienId, bienId))
    .orderBy(photosBienTable.ordre, photosBienTable.creeLe, photosBienTable.id);
  return lignes.map(ligneVersPhotoBien);
}

export async function getPhotoBien(photoId: string): Promise<PhotoBien | undefined> {
  if (!UUID_REGEX.test(photoId)) return undefined;
  const [ligne] = await getDb().select().from(photosBienTable).where(eq(photosBienTable.id, photoId)).limit(1);
  return ligne ? ligneVersPhotoBien(ligne) : undefined;
}

export async function getPhotoPrincipaleBien(bienId: string): Promise<PhotoBien | undefined> {
  if (!UUID_REGEX.test(bienId)) return undefined;
  const [ligne] = await getDb()
    .select()
    .from(photosBienTable)
    .where(eq(photosBienTable.bienId, bienId))
    .orderBy(photosBienTable.ordre, photosBienTable.creeLe, photosBienTable.id)
    .limit(1);
  return ligne ? ligneVersPhotoBien(ligne) : undefined;
}

// Sous-requête corrélée réutilisée par bienRepository (listerBiens/rechercherBiensPage, ADR-052
// §16) : UN seul aller-retour SQL pour toute une page de résultats, jamais une requête
// getPhotoPrincipaleBien() par card (N+1 explicitement interdit). Même tri total que
// getPhotoPrincipaleBien() ci-dessus — les deux DOIVENT toujours désigner la même photo.
//
// `"biens"."id"` est écrit qualifié en dur (jamais via ${biensTable.id}) : les interpolations
// Drizzle rendent une colonne sans préfixe de table dès qu'aucune jointure n'est détectée dans LE
// contexte où l'expression est construite — une fois nichée dans cette sous-requête (FROM
// photos_bien), une référence non qualifiée à `id` se résout contre photos_bien.id, PAS biens.id
// (collision de nom silencieuse, jamais d'erreur SQL : la sous-requête retournait alors toujours
// NULL). Vérifié par génération de SQL réelle (`.toSQL()`) avant correction.
export const photoPrincipaleIdSubquery = sql<string | null>`(
  SELECT ${photosBienTable.id} FROM ${photosBienTable}
  WHERE ${photosBienTable.bienId} = "biens"."id"
  ORDER BY ${photosBienTable.ordre} ASC, ${photosBienTable.creeLe} ASC, ${photosBienTable.id} ASC
  LIMIT 1
)`;

export class ErreurLimitePhotosAtteinte extends Error {
  constructor() {
    super(`Limite de ${NOMBRE_MAX_PHOTOS_PAR_BIEN} photos par bien atteinte.`);
    this.name = "ErreurLimitePhotosAtteinte";
  }
}

// Verrou de sérialisation (ADR-052 §9) : SELECT ... FOR UPDATE sur la ligne du bien, à l'intérieur
// de la transaction appelante — sérialise toutes les mutations de galerie (ajout/réorganisation/
// suppression) d'un MÊME bien entre elles, sans jamais bloquer celles d'un autre bien. C'est ce
// verrou, pas un test-puis-écriture non protégé, qui garantit que la limite de
// NOMBRE_MAX_PHOTOS_PAR_BIEN reste correcte même sous upload concurrent.
async function verrouillerBien(tx: Executeur, bienId: string): Promise<void> {
  const [ligne] = await tx.select({ id: biensTable.id }).from(biensTable).where(eq(biensTable.id, bienId)).for("update");
  if (!ligne) throw new Error("Bien introuvable.");
}

export type NouvellePhotoBien = {
  bienId: string;
  cleStockage: string;
  nomFichierOriginal: string;
  typeMimeOriginal: string;
  tailleOctetsOriginal: number;
  hashSha256: string;
};

// Le fichier (original + version optimisée) est déjà écrit sur disque par l'appelant avant cet
// appel — insertion pure sous verrou, même principe que les autres repositories. `ordre` n'est
// jamais fourni par l'appelant : calculé ici, sous le même verrou, comme MAX(ordre)+1 pour ce bien
// (0 si galerie vide) — toujours en fin de galerie (ADR-052 §11).
export async function ajouterPhotoBien(input: NouvellePhotoBien): Promise<PhotoBien> {
  return getDb().transaction(async (tx) => {
    await verrouillerBien(tx, input.bienId);

    const [{ total }] = await tx
      .select({ total: count() })
      .from(photosBienTable)
      .where(eq(photosBienTable.bienId, input.bienId));
    if (total >= NOMBRE_MAX_PHOTOS_PAR_BIEN) throw new ErreurLimitePhotosAtteinte();

    const [{ ordreMax }] = await tx
      .select({ ordreMax: sql<number | null>`max(${photosBienTable.ordre})` })
      .from(photosBienTable)
      .where(eq(photosBienTable.bienId, input.bienId));
    const ordre = ordreMax == null ? 0 : ordreMax + 1;

    const [ligne] = await tx
      .insert(photosBienTable)
      .values({
        bienId: input.bienId,
        cleStockage: input.cleStockage,
        nomFichierOriginal: input.nomFichierOriginal,
        typeMimeOriginal: input.typeMimeOriginal,
        tailleOctetsOriginal: input.tailleOctetsOriginal,
        hashSha256: input.hashSha256,
        ordre,
      })
      .returning();
    return ligneVersPhotoBien(ligne);
  });
}

// Réécriture complète 0..N-1 (ADR-052 §12) — jamais une mise à jour partielle. `photoIdsOrdonnes`
// doit être un UUID valide pour chaque entrée, appartenir intégralement à `bienId`, sans doublon ni
// omission : tout écart rejette l'opération ENTIÈRE ("invalide"), rien n'est écrit. La première
// photo de la liste devient mécaniquement la photo principale (même tri que
// getPhotoPrincipaleBien : ordre=0 la place toujours en tête).
export async function reordonnerPhotosBien(bienId: string, photoIdsOrdonnes: string[]): Promise<"ok" | "invalide"> {
  if (!UUID_REGEX.test(bienId)) return "invalide";
  if (photoIdsOrdonnes.length === 0 || !photoIdsOrdonnes.every((id) => UUID_REGEX.test(id))) return "invalide";
  if (new Set(photoIdsOrdonnes).size !== photoIdsOrdonnes.length) return "invalide";

  return getDb().transaction(async (tx) => {
    await verrouillerBien(tx, bienId);

    const actuelles = await tx.select({ id: photosBienTable.id }).from(photosBienTable).where(eq(photosBienTable.bienId, bienId));
    const ensembleActuel = new Set(actuelles.map((l) => l.id));
    const memeEnsemble =
      ensembleActuel.size === photoIdsOrdonnes.length && photoIdsOrdonnes.every((id) => ensembleActuel.has(id));
    if (!memeEnsemble) return "invalide";

    for (let i = 0; i < photoIdsOrdonnes.length; i++) {
      await tx.update(photosBienTable).set({ ordre: i }).where(eq(photosBienTable.id, photoIdsOrdonnes[i]));
    }
    return "ok";
  });
}

// DB d'abord, fichiers ensuite (ADR-052 §13) : une incohérence résiduelle doit toujours se
// résoudre en fichier orphelin (invisible), jamais en ligne DB pointant vers un fichier absent
// (visible, cassé). undefined = idempotent — photo déjà absente, aucune erreur, rien à verrouiller
// (son bienId est inconnu). Le nettoyage physique (best-effort) reste à la charge de l'appelant
// (src/actions/supprimerPhotoBien.ts), qui dispose de cleStockage via la ligne retournée.
export async function supprimerPhotoBien(photoId: string): Promise<PhotoBien | undefined> {
  if (!UUID_REGEX.test(photoId)) return undefined;

  const [avant] = await getDb().select().from(photosBienTable).where(eq(photosBienTable.id, photoId)).limit(1);
  if (!avant) return undefined;

  return getDb().transaction(async (tx) => {
    await verrouillerBien(tx, avant.bienId);
    const [supprimee] = await tx.delete(photosBienTable).where(eq(photosBienTable.id, photoId)).returning();
    return supprimee ? ligneVersPhotoBien(supprimee) : undefined;
  });
}
