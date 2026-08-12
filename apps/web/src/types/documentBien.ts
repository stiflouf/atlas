export type CategorieDocument =
  | "mandat"
  | "diagnostic"
  | "copropriete"
  | "technique"
  | "commercial"
  | "compromis"
  | "autre";

export const LABEL_CATEGORIE_DOCUMENT: Record<CategorieDocument, string> = {
  mandat: "Mandat",
  diagnostic: "Diagnostic",
  copropriete: "Copropriété",
  technique: "Technique",
  commercial: "Commercial",
  compromis: "Compromis",
  autre: "Autre",
};

// cleStockage est un identifiant opaque généré côté serveur (src/lib/stockageDocuments.ts),
// jamais dérivé d'un nom fourni par l'utilisateur — voir ADR stockage local V1.
export type DocumentBien = {
  id: string;
  bienId: string;
  nom: string;
  categorie: CategorieDocument;
  nomFichierOriginal: string;
  cleStockage: string;
  tailleOctets: number;
  typeMime: string;
  creeLe: string;
};
