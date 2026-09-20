import { NextResponse } from "next/server";
import { getDocumentBonVisitePourTelechargement } from "@/lib/bonVisiteRepository";
import { ErreurStockageDocumentsIndisponible, lireDocument } from "@/lib/stockageDocuments";
import { refuserSiSessionAtlasAbsente } from "@/lib/auth/exigerSessionAtlasRoute";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

type RouteProps = { params: Promise<{ id: string }> };

// VISIT_SIGNED_FORM_V1 (ADR-063 §40) — téléchargement DÉDIÉ et workspace-safe du document final
// signé. Ne passe JAMAIS par le Route Handler générique /api/documents/[id] (getDocumentBienById
// n'est pas scopé workspace, gap pré-existant du domaine Documents, hors périmètre de ce lot) :
// getDocumentBonVisitePourTelechargement porte lui-même la jointure bon→visite→bien→workspace, donc
// un id de bon d'un autre workspace est INTROUVABLE ici, jamais servi (§54, testé).
export async function GET(_request: Request, { params }: RouteProps) {
  const refus = await refuserSiSessionAtlasAbsente();
  if (refus) return refus;
  const { id } = await params;

  let workspaceId: string;
  try {
    workspaceId = await exigerWorkspaceCourant();
  } catch {
    return NextResponse.json({ erreur: "Non autorisé." }, { status: 401 });
  }

  const document = await getDocumentBonVisitePourTelechargement(id, workspaceId);
  if (!document) return new NextResponse(null, { status: 404 });

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
