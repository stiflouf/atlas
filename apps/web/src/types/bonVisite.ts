// VISIT_SIGNED_FORM_V1 (ADR-063) — le bon de visite est l'instance/version de document préparée
// pour une Visite ; l'acte de signature (SignatureBonVisite) est un objet enfant distinct,
// potentiellement multiple (schéma multi-signataire dès V1, parcours UI V1 concentré sur un
// signataire principal — voir docs/adr/063-visit-maturity.md, VISIT_SINGLE_OR_MULTI_SIGNER_V1).

export type StatutBonVisite = "brouillon" | "signe" | "annule";

export const LABEL_STATUT_BON_VISITE: Record<StatutBonVisite, string> = {
  brouillon: "Brouillon",
  signe: "Signé",
  annule: "Annulé",
};

// Figé au moment de la préparation/signature (§5 du brief VISIT_SIGNED_FORM_V1) — jamais recalculé
// après coup, même si la Visite/le Bien changent ensuite (testé). Le signataire N'EST PAS dans ce
// snapshot : il vit sur chaque SignatureBonVisite (une ligne par signataire), pas sur le bon
// lui-même — un bon multi-signataire aurait sinon un snapshot ambigu.
export type SnapshotBonVisite = {
  visite: { id: string; datePrevue: string; realiseeLe?: string };
  bien: { id: string; reference: string; titre: string; adresse: string; ville: string; codePostal: string };
  conseiller: { nom: string };
  // Texte RÉELLEMENT présenté (placeholders déjà substitués), pas seulement la version du template
  // — voir templateBonVisite.ts. `version` permet de savoir quel gabarit a produit ce texte.
  template: { version: string; texte: string };
};

export type BonVisite = {
  id: string;
  visiteId: string;
  version: number;
  statut: StatutBonVisite;
  templateVersion: string;
  contenuSnapshot: SnapshotBonVisite;
  documentId?: string;
  hashDocument?: string;
  creeLe: string;
  signeLe?: string;
  annuleLe?: string;
};

export type RoleSignataire = "principal" | "secondaire";

// V1 : une seule valeur possible ("domiora", signature tactile native) — le champ existe pour
// accueillir un futur fournisseur externe sans redesign (§9 du brief).
export type ProviderSignature = "domiora";

export type SignatureBonVisite = {
  id: string;
  bonVisiteId: string;
  contactId?: string;
  roleSignataire: RoleSignataire;
  nomSnapshot: string;
  prenomSnapshot?: string;
  emailSnapshot?: string;
  provider: ProviderSignature;
  externalSignatureId?: string;
  signatureCleStockage: string;
  consentementConfirmeLe: string;
  signeLe: string;
  creeLe: string;
};
