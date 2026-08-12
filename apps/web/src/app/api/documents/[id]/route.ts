import { NextResponse } from "next/server";
import { getDocumentBienById } from "@/lib/documentBienRepository";
import { lireDocument } from "@/lib/stockageDocuments";

type RouteProps = { params: Promise<{ id: string }> };

// Ne révèle jamais le chemin physique : la clé de stockage ne quitte jamais le serveur. 404 si
// la métadonnée est absente (id invalide/inexistant) ou si le fichier physique est absent
// (métadonnée orpheline) — pas de distinction observable entre les deux cas.
export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const document = await getDocumentBienById(id);
  if (!document) return new NextResponse(null, { status: 404 });

  const contenu = await lireDocument(document.cleStockage);
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
