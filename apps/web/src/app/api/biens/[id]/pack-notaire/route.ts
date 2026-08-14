import { NextResponse } from "next/server";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { listerCompromisPourBien } from "@/lib/compromisRepository";
import { listerDocumentsPourBien } from "@/lib/documentBienRepository";
import { getProspectVendeurParBien } from "@/lib/prospectVendeurRepository";
import { calculerPackNotaire, type ContextePackNotaire } from "@/lib/documents/packNotaire";
import { ErreurGenerationPack, genererZipPackNotaire } from "@/lib/documents/genererZipPackNotaire";
import type { DocumentBien } from "@/types/documentBien";

type RouteProps = { params: Promise<{ id: string }> };

async function chargerContexte(bienId: string) {
  const bien = await getBienById(bienId);
  if (!bien) return undefined;
  const documents = await listerDocumentsPourBien(bien.id);
  const compromis = await listerCompromisPourBien(bien.id);
  const compromisActuel =
    compromis.find((c) => c.statut === "en_cours") ??
    [...compromis].sort((a, b) => (a.dateSignature < b.dateSignature ? 1 : -1))[0];
  const prospectVendeurOrigine = await getProspectVendeurParBien(bien.id);
  const acquereur = compromisActuel ? await getClientById(compromisActuel.acquereurId) : undefined;
  const ctx: ContextePackNotaire = { bien, compromisActuel, prospectVendeurOrigine, acquereur };
  return { ctx, documents };
}

// Refus explicite, jamais un ZIP partiel (ADR-030) : bien introuvable (404) ; aucun compromis en
// cours (409 — aucun export transactionnel sans contexte réel, correction n°2) ; sélection vide,
// id inconnu ou id techniquement interdit (400, nomme le document concerné) ; taille cumulée hors
// limite ou fichier illisible (422, porté par genererZipPackNotaire). Recalcule systématiquement
// le pack côté serveur — ne fait jamais confiance à la sélection brute envoyée par le client
// (même discipline que les Server Actions ADR-015/016/029).
export async function POST(request: Request, { params }: RouteProps) {
  const { id } = await params;
  const contexte = await chargerContexte(id);
  if (!contexte) return NextResponse.json({ erreur: "Bien introuvable." }, { status: 404 });
  const { ctx, documents } = contexte;

  if (!ctx.compromisActuel) {
    return NextResponse.json(
      { erreur: "Aucun compromis en cours pour ce bien — export indisponible (contexte transactionnel incomplet)." },
      { status: 409 }
    );
  }

  const pack = calculerPackNotaire(ctx, documents);

  const formData = await request.formData();
  const idsDemandes = formData.getAll("documentIds").map(String);
  if (idsDemandes.length === 0) {
    return NextResponse.json({ erreur: "Aucun document sélectionné." }, { status: 400 });
  }

  const idsAutorises = new Set([...pack.selectionProposee, ...pack.documentsDisponibles].map((d) => d.id));
  const documentsParId = new Map(documents.map((d) => [d.id, d]));
  const documentsSelectionnes: DocumentBien[] = [];
  for (const idDemande of idsDemandes) {
    const doc = documentsParId.get(idDemande);
    if (!doc || !idsAutorises.has(idDemande)) {
      const nom = doc?.nom ?? idDemande;
      return NextResponse.json(
        { erreur: `« ${nom} » ne peut pas être inclus dans ce pack — export annulé, aucun ZIP généré.` },
        { status: 400 }
      );
    }
    documentsSelectionnes.push(doc);
  }

  try {
    const zip = await genererZipPackNotaire(ctx, pack, documentsSelectionnes);
    const nomFichier = `pack-notaire-${ctx.bien.reference.replace(/[^a-zA-Z0-9-]+/g, "_")}.zip`;
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${nomFichier}"`,
        "Content-Length": String(zip.byteLength),
      },
    });
  } catch (erreur) {
    if (erreur instanceof ErreurGenerationPack) {
      return NextResponse.json({ erreur: erreur.message }, { status: 422 });
    }
    throw erreur;
  }
}
