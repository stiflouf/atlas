import type { CategorieDocument, EtatVerificationDocument, TypeDocument } from "@/types/documentBien";

// Un document tel qu'il était au moment T de la transmission (ADR-049) — figé, jamais recalculé à
// la lecture. sha256 identifie les octets réellement transmis, pas documentId/cleStockage/nom (voir
// enregistrerTransmissionDossierNotaireAction). Volontairement pas de cleStockage/chemin filesystem
// ici : rien d'exploitable par un tiers, uniquement ce qui décrit le document lui-même.
export type DocumentManifesteSnapshot = {
  documentId: string;
  nomExport: string;
  nomOriginal: string;
  categorie: CategorieDocument;
  typeDocument?: TypeDocument;
  etatVerification: EtatVerificationDocument;
  tailleOctets: number;
  sha256: string;
};

// manifesteTexte = même texte que celui inclus dans le ZIP (genererManifestePackNotaire), conservé
// tel quel pour une lecture humaine identique à celle vue au moment de la transmission.
export type ManifesteSnapshot = {
  manifesteTexte: string;
  documents: DocumentManifesteSnapshot[];
};

// Fait historique immuable — aucune Server Action de modification/suppression n'existe pour cette
// entité (ADR-049 §10). transmisLe (déclaré par le conseiller) est distinct de creeLe (horodatage
// serveur de l'enregistrement lui-même). manifesteVersion est la seule source de vérité du format
// de manifesteSnapshot (pas de champ version dupliqué dans le JSON).
export type TransmissionDossierNotaire = {
  id: string;
  compromisId: string;
  cleIdempotence: string;
  etudeNom: string;
  destinataireNom?: string;
  destinataireEmail?: string;
  transmisLe: string;
  creeParEmail: string;
  manifesteVersion: number;
  manifesteSnapshot: ManifesteSnapshot;
  creeLe: string;
};

export type NouvelleTransmissionDossierNotaire = Omit<TransmissionDossierNotaire, "id" | "creeLe" | "manifesteVersion"> & {
  manifesteVersion?: number;
};
