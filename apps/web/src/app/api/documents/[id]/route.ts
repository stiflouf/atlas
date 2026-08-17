import { NextResponse } from "next/server";
import { getDocumentBienById } from "@/lib/documentBienRepository";
import { ErreurStockageDocumentsIndisponible, lireDocument } from "@/lib/stockageDocuments";
import { refuserSiSessionAtlasAbsente } from "@/lib/auth/exigerSessionAtlasRoute";

type RouteProps = { params: Promise<{ id: string }> };

// Ne révèle jamais le chemin physique : la clé de stockage ne quitte jamais le serveur. 404 si
// la métadonnée est absente (id invalide/inexistant) ou si le fichier physique est absent
// (métadonnée orpheline) — pas de distinction observable entre les deux cas.
//
// ADR-047 : protégé par la session Atlas (cookie envoyé automatiquement par le navigateur sur ce
// <a href> brut — jamais un Bearer, structurellement incompatible avec un lien HTML simple).
// Anonyme + UUID valide → aucun octet transmis, la garde s'exécute avant toute lecture du fichier.
export async function GET(_request: Request, { params }: RouteProps) {
  const refus = await refuserSiSessionAtlasAbsente();
  if (refus) return refus;
  const { id } = await params;
  const document = await getDocumentBienById(id);
  if (!document) return new NextResponse(null, { status: 404 });

  // ADR-050 : un volume/répertoire de stockage indisponible n'est jamais confondu avec un document
  // manquant — 503 honnête plutôt qu'un faux 404.
  let contenu: Buffer | undefined;
  try {
    contenu = await lireDocument(document.cleStockage);
  } catch (erreur) {
    if (erreur instanceof ErreurStockageDocumentsIndisponible) {
      return NextResponse.json({ erreur: "Stockage documentaire indisponible." }, { status: 503 });
    }
    throw erreur;
  }
  if (!contenu) return new NextResponse(null, { status: 404 });

  const nomSur = document.nomFichierOriginal.replace(/["\r\n]/g, "");
  return new NextResponse(new Uint8Array(contenu), {
    headers: {
      "Content-Type": document.typeMime,
      "Content-Disposition": `attachment; filename="${nomSur}"; filename*=UTF-8''${encodeURIComponent(document.nomFichierOriginal)}`,
      "Content-Length": String(document.tailleOctets),
    },
  });
}
