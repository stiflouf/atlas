"use server";

import { notFound, redirect } from "next/navigation";
import { listerPhotosBien, reordonnerPhotosBien, supprimerPhotoBien } from "@/lib/photoBienRepository";
import { supprimerPhotoOptimisee, supprimerPhotoOriginale } from "@/lib/stockagePhotosBien";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

type Direction = "monter" | "descendre" | "principale";

function calculerNouvelOrdre(idsActuels: string[], photoId: string, direction: Direction): string[] | undefined {
  const index = idsActuels.indexOf(photoId);
  if (index === -1) return undefined;

  if (direction === "principale") {
    if (index === 0) return undefined; // déjà principale, rien à réécrire
    return [idsActuels[index], ...idsActuels.slice(0, index), ...idsActuels.slice(index + 1)];
  }

  const voisin = direction === "monter" ? index - 1 : index + 1;
  if (voisin < 0 || voisin >= idsActuels.length) return undefined; // déjà en tête/en fin

  const nouveaux = [...idsActuels];
  [nouveaux[index], nouveaux[voisin]] = [nouveaux[voisin], nouveaux[index]];
  return nouveaux;
}

// Boutons simples (ADR-052 §23) : aucune librairie drag-and-drop. Chaque bouton soumet
// bienId/photoId/direction ; l'action relit la galerie courante puis soumet le nouvel ordre
// complet à reordonnerPhotosBien(), qui verrouille et revalide sous transaction. « Définir comme
// principale » n'est pas un chemin séparé : c'est un déplacement en position 0 (ADR-052 §5) —
// aucune colonne est_principale. Page cible en `force-dynamic` (biens/[id]/photos/page.tsx) :
// redirect() suffit à obtenir un rendu frais, comme le reste des Server Actions de mutation Bien
// de ce projet (archiverBienAction, etc. — aucune n'utilise revalidatePath).
export async function deplacerPhotoBienAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const bienId = String(formData.get("bienId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  const direction = String(formData.get("direction") ?? "") as Direction;
  if (!bienId || !photoId) notFound();

  const galerie = await listerPhotosBien(bienId);
  const nouvelOrdre = calculerNouvelOrdre(
    galerie.map((p) => p.id),
    photoId,
    direction
  );

  if (nouvelOrdre) {
    // Résultat "invalide" = course rare (galerie modifiée entre la lecture ci-dessus et l'écriture
    // verrouillée) — jamais une réorganisation à moitié appliquée : la page recharge simplement
    // l'état réel actuel.
    await reordonnerPhotosBien(bienId, nouvelOrdre);
  }

  redirect(`/biens/${bienId}/photos`);
}

// Idempotente : une photo déjà absente n'est jamais une erreur (ADR-052 §13). DB d'abord, fichiers
// ensuite en best-effort — une erreur filesystem reste invisible pour l'utilisateur, jamais
// transformée en photo fantôme (la ligne DB est déjà supprimée quoi qu'il arrive côté fichiers).
export async function supprimerPhotoBienAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const bienId = String(formData.get("bienId") ?? "");
  const photoId = String(formData.get("photoId") ?? "");
  if (!bienId || !photoId) notFound();

  const supprimee = await supprimerPhotoBien(photoId);
  if (supprimee) {
    await supprimerPhotoOriginale(supprimee.cleStockage).catch((e) =>
      console.error("[photos-bien] suppression fichier original échouée (clé %s) :", supprimee.cleStockage, e)
    );
    await supprimerPhotoOptimisee(supprimee.cleStockage).catch((e) =>
      console.error("[photos-bien] suppression fichier optimisée échouée (clé %s) :", supprimee.cleStockage, e)
    );
  }

  redirect(`/biens/${bienId}/photos`);
}
