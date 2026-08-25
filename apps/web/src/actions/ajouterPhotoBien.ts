"use server";

import { getBienById } from "@/lib/bienRepository";
import { ErreurLimitePhotosAtteinte, ajouterPhotoBien } from "@/lib/photoBienRepository";
import {
  ecrirePhotoOptimisee,
  ecrirePhotoOriginale,
  genererCleStockage,
  supprimerPhotoOptimisee,
  supprimerPhotoOriginale,
} from "@/lib/stockagePhotosBien";
import { ErreurPhotoInvalide, traiterPhotoBien } from "@/lib/traitementPhotoBien";
import { TAILLE_MAX_PHOTO_OCTETS, type PhotoBien } from "@/types/photoBien";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

export type ResultatAjoutPhotoBien = { succes: true; photo: PhotoBien } | { succes: false; erreur: string };

// Une Server Action = une photo (ADR-052 §10/§24) : appelée directement depuis le composant client
// d'upload multiple (jamais via <form action=...>, ce dernier ne permet pas un feedback par
// fichier) — retourne un résultat plutôt que redirect()/throw pour void, afin qu'un échec sur un
// fichier n'annule jamais les fichiers déjà envoyés avec succès dans le même lot.
//
// Séquence d'intégrité : traitement Sharp (rejette un contenu réellement illisible AVANT toute
// écriture) → clé opaque → écriture original → écriture optimisée → INSERT DB. Une incohérence
// résiduelle se résout toujours en fichier(s) orphelin(s), jamais en ligne DB pointant vers un
// fichier absent.
export async function ajouterPhotoBienAction(formData: FormData): Promise<ResultatAjoutPhotoBien> {
  await exigerSessionAtlas();

  const bienId = String(formData.get("bienId") ?? "");
  const fichier = formData.get("fichier");

  if (!bienId) return { succes: false, erreur: "Bien introuvable." };
  if (!(fichier instanceof File) || fichier.size === 0) {
    return { succes: false, erreur: "Un fichier est obligatoire." };
  }
  if (fichier.size > TAILLE_MAX_PHOTO_OCTETS) {
    return { succes: false, erreur: "Le fichier dépasse la taille maximale autorisée (12 Mo)." };
  }

  const bien = await getBienById(bienId);
  if (!bien) return { succes: false, erreur: "Bien introuvable." };
  if (bien.archiveLe) return { succes: false, erreur: "Impossible d'ajouter une photo sur un bien archivé." };

  const octetsOriginal = Buffer.from(await fichier.arrayBuffer());

  let traitement;
  try {
    traitement = await traiterPhotoBien(octetsOriginal);
  } catch (erreur) {
    if (erreur instanceof ErreurPhotoInvalide) return { succes: false, erreur: erreur.message };
    throw erreur;
  }

  const cleStockage = genererCleStockage();
  await ecrirePhotoOriginale(cleStockage, octetsOriginal);

  try {
    await ecrirePhotoOptimisee(cleStockage, traitement.bufferOptimise);
  } catch (erreur) {
    await supprimerPhotoOriginale(cleStockage).catch((e) =>
      console.error("[photos-bien] compensation original échouée (clé %s) :", cleStockage, e)
    );
    throw erreur;
  }

  try {
    const photo = await ajouterPhotoBien({
      bienId,
      cleStockage,
      nomFichierOriginal: fichier.name,
      typeMimeOriginal: traitement.typeMimeOriginal,
      tailleOctetsOriginal: fichier.size,
      hashSha256: traitement.hashSha256,
    });
    return { succes: true, photo };
  } catch (erreur) {
    await supprimerPhotoOriginale(cleStockage).catch((e) =>
      console.error("[photos-bien] compensation original échouée (clé %s) :", cleStockage, e)
    );
    await supprimerPhotoOptimisee(cleStockage).catch((e) =>
      console.error("[photos-bien] compensation optimisée échouée (clé %s) :", cleStockage, e)
    );
    if (erreur instanceof ErreurLimitePhotosAtteinte) return { succes: false, erreur: erreur.message };
    throw erreur;
  }
}
