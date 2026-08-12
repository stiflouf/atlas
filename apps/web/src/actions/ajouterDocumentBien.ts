"use server";

import { redirect } from "next/navigation";
import { getBienById } from "@/lib/bienRepository";
import { enregistrerDocumentBien } from "@/lib/documentBienRepository";
import { ecrireDocument, genererCleStockage } from "@/lib/stockageDocuments";
import type { CategorieDocument } from "@/types/documentBien";

const CATEGORIES_VALIDES: CategorieDocument[] = [
  "mandat",
  "diagnostic",
  "copropriete",
  "technique",
  "commercial",
  "compromis",
  "autre",
];

// V1 : liste blanche volontairement restreinte (pas d'archives, pas de bureautique) — voir ADR
// stockage local V1.
const TYPES_MIME_AUTORISES = ["application/pdf", "image/jpeg", "image/png"];
const TAILLE_MAX_OCTETS = 10 * 1024 * 1024;

function parseCategorie(valeur: FormDataEntryValue | null): CategorieDocument {
  return CATEGORIES_VALIDES.includes(valeur as CategorieDocument) ? (valeur as CategorieDocument) : "autre";
}

// Refus simple, sans écriture disque ni insertion, si le bien n'existe plus ou est archivé
// (ADR-012), si le fichier est absent/vide, si son type MIME n'est pas dans la liste blanche, ou
// si sa taille dépasse 10 Mo. Le fichier n'est écrit sur disque qu'après validation complète —
// jamais avant, jamais si l'insertion DB qui suit pourrait échouer sur un bien invalide.
export async function ajouterDocumentBienAction(formData: FormData): Promise<void> {
  const bienId = String(formData.get("bienId") ?? "");
  const nom = String(formData.get("nom") ?? "").trim();
  const categorie = parseCategorie(formData.get("categorie"));
  const fichier = formData.get("fichier");

  if (
    bienId &&
    nom &&
    fichier instanceof File &&
    fichier.size > 0 &&
    fichier.size <= TAILLE_MAX_OCTETS &&
    TYPES_MIME_AUTORISES.includes(fichier.type)
  ) {
    const bien = await getBienById(bienId);
    if (bien && !bien.archiveLe) {
      const cleStockage = genererCleStockage();
      const octets = Buffer.from(await fichier.arrayBuffer());
      await ecrireDocument(cleStockage, octets);
      await enregistrerDocumentBien({
        bienId,
        nom,
        categorie,
        nomFichierOriginal: fichier.name,
        cleStockage,
        tailleOctets: fichier.size,
        typeMime: fichier.type,
      });
    }
  }

  redirect(`/biens/${bienId}`);
}
