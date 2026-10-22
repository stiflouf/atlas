import { readdir } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/db/client";
import { documentsBien, photosBien, signaturesBonVisite } from "@/db/schema";
import { verifierDisponibiliteStockageDocuments } from "../stockageDocuments";
import { fichierStockeExiste, type GenreFichierStocke, type RessourceFichierStocke } from "./suppressionFichier";

// FILE_DELETION_PRIMITIVE_V1 (ADR-067) — inventaire STRICTEMENT en lecture seule des divergences
// entre les références de fichiers en base et le contenu réel du stockage.
//
// Aucune suppression de fichier, aucun DELETE SQL, aucune correction automatique, aucun cron. Ce module
// constate ; il ne répare pas. C'est délibéré : les deux divergences qu'il détecte n'ont pas la même
// cause ni la même conclusion (une référence sans fichier est une perte déjà consommée, un fichier
// sans référence peut être un reste d'écriture interrompue comme un fichier légitime écrit par un
// chemin que l'inventaire ne connaît pas encore), et aucune des deux ne se solde par une suppression
// sans décision humaine.
//
// Sortie sans PII : type de ressource, identifiant technique de la ligne, et motif. Jamais
// nomFichierOriginal, jamais une donnée de bien ou de contact — un inventaire d'exploitation se lit
// dans un journal, pas dans un dossier client.

export type MotifOrphelin =
  // Une ligne en base désigne une clé de stockage dont le fichier est absent du disque.
  | "reference_sans_fichier"
  // Un fichier est présent sous la racine mais aucune ligne connue ne le référence.
  | "fichier_sans_reference"
  // La clé en base n'a pas la forme produite par genererCleStockage() : le chemin ne peut pas être
  // construit sûrement, donc l'existence du fichier n'est pas vérifiable. Jamais confondu avec une
  // absence.
  | "cle_non_verifiable";

export type EntreeInventaireOrphelins = {
  genre: GenreFichierStocke;
  motif: MotifOrphelin;
  // Identifiant de la ligne en base pour les deux premiers motifs ; undefined pour un fichier sans
  // référence, qui par définition n'a pas de ligne.
  ligneId?: string;
  table?: "documents_bien" | "photos_bien" | "signatures_bon_visite";
  // Nom physique constaté sur disque, uniquement pour « fichier_sans_reference » : c'est un UUID
  // opaque, jamais un nom d'origine.
  nomFichier?: string;
};

export type InventaireOrphelins = {
  entrees: EntreeInventaireOrphelins[];
  referencesExaminees: number;
  fichiersExamines: number;
  // Le balayage disque est optionnel : il n'est fiable que si l'inventaire connaît TOUS les
  // producteurs de fichiers de la racine. Quand il est désactivé, le dire explicitement plutôt que
  // de renvoyer une liste vide qu'on pourrait lire comme « aucun fichier orphelin ».
  balayageDisqueEffectue: boolean;
};

type ReferenceFichier = {
  genres: GenreFichierStocke[];
  ligneId: string;
  cleStockage: string;
  table: NonNullable<EntreeInventaireOrphelins["table"]>;
};

async function collecterReferences(): Promise<ReferenceFichier[]> {
  const db = getDb();

  const [documents, photos, signatures] = await Promise.all([
    db.select({ id: documentsBien.id, cleStockage: documentsBien.cleStockage }).from(documentsBien),
    db.select({ id: photosBien.id, cleStockage: photosBien.cleStockage }).from(photosBien),
    db
      .select({ id: signaturesBonVisite.id, cleStockage: signaturesBonVisite.signatureCleStockage })
      .from(signaturesBonVisite),
  ]);

  return [
    // Le PDF d'un bon de visite signé n'est pas une catégorie à part : signerBonVisite crée une
    // ligne documents_bien ordinaire, donc il est déjà couvert par le balayage des documents.
    ...documents.map((l) => ({ genres: ["document" as const], ligneId: l.id, cleStockage: l.cleStockage, table: "documents_bien" as const })),
    // Une photo, c'est DEUX fichiers pour une seule clé : l'original et la version servie. L'un peut
    // manquer sans l'autre (l'écriture de l'optimisée suit celle de l'original, hors transaction).
    ...photos.map((l) => ({
      genres: ["photo_originale" as const, "photo_optimisee" as const],
      ligneId: l.id,
      cleStockage: l.cleStockage,
      table: "photos_bien" as const,
    })),
    ...signatures.map((l) => ({ genres: ["document" as const], ligneId: l.id, cleStockage: l.cleStockage, table: "signatures_bon_visite" as const })),
  ];
}

async function listerFichiers(repertoire: string): Promise<string[]> {
  try {
    const entrees = await readdir(repertoire, { withFileTypes: true });
    return entrees.filter((e) => e.isFile()).map((e) => e.name);
  } catch (erreur) {
    // Un sous-répertoire photos/... absent signifie « aucune photo écrite ici », pas une anomalie :
    // racinePhotos ne le crée qu'au premier upload, et jamais en production.
    if ((erreur as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw erreur;
  }
}

// options.balayerDisque : par défaut false. Le sens d'un fichier sans référence dépend de la
// connaissance exhaustive des producteurs ; l'appelant l'active quand il sait que c'est le cas (un
// contrôle d'exploitation), pas par défaut.
export async function inventorierOrphelins(
  options: { balayerDisque?: boolean } = {}
): Promise<InventaireOrphelins> {
  const references = await collecterReferences();
  const entrees: EntreeInventaireOrphelins[] = [];
  const nomsReferences = new Set<string>();

  for (const reference of references) {
    for (const genre of reference.genres) {
      const ressource: RessourceFichierStocke = { genre, cleStockage: reference.cleStockage };
      let existe: boolean;
      try {
        existe = await fichierStockeExiste(ressource);
      } catch (erreur) {
        if ((erreur as Error).name === "ErreurCleStockageInvalide" || (erreur as Error).name === "ErreurCheminHorsRacineStockage") {
          entrees.push({ genre, motif: "cle_non_verifiable", ligneId: reference.ligneId, table: reference.table });
          continue;
        }
        throw erreur;
      }
      nomsReferences.add(`${genre}:${genre === "photo_optimisee" ? `${reference.cleStockage}.webp` : reference.cleStockage}`);
      if (!existe) {
        entrees.push({ genre, motif: "reference_sans_fichier", ligneId: reference.ligneId, table: reference.table });
      }
    }
  }

  if (!options.balayerDisque) {
    return {
      entrees,
      referencesExaminees: references.length,
      fichiersExamines: 0,
      balayageDisqueEffectue: false,
    };
  }

  const racine = await verifierDisponibiliteStockageDocuments();
  const repertoiresParGenre: Array<{ genre: GenreFichierStocke; repertoire: string }> = [
    { genre: "document", repertoire: racine },
    { genre: "photo_originale", repertoire: path.join(racine, "photos/originaux") },
    { genre: "photo_optimisee", repertoire: path.join(racine, "photos/optimisees") },
  ];

  let fichiersExamines = 0;
  for (const { genre, repertoire } of repertoiresParGenre) {
    for (const nomFichier of await listerFichiers(repertoire)) {
      fichiersExamines += 1;
      if (!nomsReferences.has(`${genre}:${nomFichier}`)) {
        entrees.push({ genre, motif: "fichier_sans_reference", nomFichier });
      }
    }
  }

  return { entrees, referencesExaminees: references.length, fichiersExamines, balayageDisqueEffectue: true };
}
