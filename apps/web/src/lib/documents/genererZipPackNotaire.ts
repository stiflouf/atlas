import JSZip from "jszip";
import { lireDocument } from "@/lib/stockageDocuments";
import type { DocumentBien } from "@/types/documentBien";
import { genererManifestePackNotaire, genererNomExport, type ContextePackNotaire, type PackNotaire } from "./packNotaire";

// Contrainte TECHNIQUE Atlas V1 (ADR-030) — jamais une règle métier/juridique. Plafond de taille
// cumulée du pack vérifié AVANT toute lecture fichier, pour borner l'empreinte mémoire d'une
// génération ZIP entièrement en mémoire (pas de streaming en V1, voir ADR-030 pour l'arbitrage).
// 200 Mo = marge confortable au-delà du plafond déjà imposé par document (10 Mo, ADR-013) pour une
// vingtaine de pièces maximum attendues par dossier en usage mono-conseiller local.
export const MAX_TAILLE_PACK_OCTETS = 200 * 1024 * 1024;

export class ErreurGenerationPack extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErreurGenerationPack";
  }
}

// Génération ATOMIQUE (ADR-030) : la taille cumulée est vérifiée AVANT toute lecture ; tous les
// fichiers sont lus et validés intégralement AVANT le premier appel à zip.file()/generateAsync —
// un seul document absent/inaccessible fait échouer la génération entière (ErreurGenerationPack),
// jamais un ZIP partiel silencieusement plus petit que la sélection demandée.
export async function genererZipPackNotaire(
  ctx: ContextePackNotaire,
  pack: PackNotaire,
  documentsSelectionnes: DocumentBien[]
): Promise<Buffer> {
  if (documentsSelectionnes.length === 0) {
    throw new ErreurGenerationPack("Aucun document sélectionné pour ce pack.");
  }

  const tailleTotale = documentsSelectionnes.reduce((somme, d) => somme + d.tailleOctets, 0);
  if (tailleTotale > MAX_TAILLE_PACK_OCTETS) {
    throw new ErreurGenerationPack(
      `Le pack dépasse la taille maximale autorisée (${Math.round(MAX_TAILLE_PACK_OCTETS / (1024 * 1024))} Mo) — retirez des documents avant de réessayer.`
    );
  }

  // Lecture intégrale AVANT toute écriture dans l'archive — aucun zip.file() n'est appelé tant
  // que tous les contenus n'ont pas été lus avec succès.
  const contenus = await Promise.all(
    documentsSelectionnes.map(async (doc) => {
      const contenu = await lireDocument(doc.cleStockage);
      if (!contenu) {
        throw new ErreurGenerationPack(`Fichier introuvable pour « ${doc.nom} » — export annulé, aucun ZIP généré.`);
      }
      return { doc, contenu };
    })
  );

  const zip = new JSZip();
  contenus.forEach(({ doc, contenu }, index) => {
    zip.file(genererNomExport(doc, index, ctx), contenu);
  });
  zip.file("manifeste.txt", genererManifestePackNotaire(ctx, pack, documentsSelectionnes));

  return zip.generateAsync({ type: "nodebuffer" });
}
