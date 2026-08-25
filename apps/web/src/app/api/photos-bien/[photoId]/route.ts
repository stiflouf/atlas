import { NextResponse } from "next/server";
import { getPhotoBien } from "@/lib/photoBienRepository";
import { ErreurStockageDocumentsIndisponible, lirePhotoOptimisee } from "@/lib/stockagePhotosBien";
import { refuserSiSessionAtlasAbsente } from "@/lib/auth/exigerSessionAtlasRoute";

type RouteProps = { params: Promise<{ photoId: string }> };

// Ne révèle jamais cleStockage : le front ne reçoit que l'id de la ligne (ADR-052 §8/§17). Sert
// TOUJOURS la version optimisée WebP (jamais l'original) — c'est elle qui porte le contrat
// d'affichage (hero/card/thumb). 404 sans distinction observable entre ligne DB absente et fichier
// physique absent, même principe que /api/documents/[id].
//
// Pas de Content-Disposition: attachment (contrairement à /api/documents/[id]) : cette route doit
// pouvoir être affichée inline par <Image unoptimized>, jamais forcer un téléchargement.
//
// Cache privé, jamais immutable (ADR-052 §20) : une photo peut être supprimée et une session
// révoquée — un cache navigateur d'un an contournerait la revalidation. L'authentification est
// vérifiée AVANT toute réponse conditionnelle 304, pour que le navigateur repasse par
// l'autorisation serveur à chaque requête même en réutilisant les octets déjà en cache local.
export async function GET(request: Request, { params }: RouteProps) {
  const refus = await refuserSiSessionAtlasAbsente();
  if (refus) return refus;

  const { photoId } = await params;
  const photo = await getPhotoBien(photoId);
  if (!photo) return new NextResponse(null, { status: 404 });

  let contenu: Buffer | undefined;
  try {
    contenu = await lirePhotoOptimisee(photo.cleStockage);
  } catch (erreur) {
    if (erreur instanceof ErreurStockageDocumentsIndisponible) {
      return NextResponse.json({ erreur: "Stockage documentaire indisponible." }, { status: 503 });
    }
    throw erreur;
  }
  if (!contenu) return new NextResponse(null, { status: 404 });

  const etag = `"${photo.hashSha256}"`;
  const cacheControl = "private, no-cache";
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }

  return new NextResponse(new Uint8Array(contenu), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": cacheControl,
      ETag: etag,
      "Content-Length": String(contenu.length),
    },
  });
}
