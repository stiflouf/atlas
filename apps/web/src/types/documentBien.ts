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

// Familles du dossier documentaire (ADR-029), utilisées par le moteur de checklist
// (src/lib/documents/checklistDossier.ts) — un vocabulaire DÉCOUPLÉ de `categorie` ci-dessus.
// `categorie` (existant, ADR-013) reste inchangée, portée par la même colonne DB, toujours
// choisie librement par le conseiller à l'ajout. `FamilleDocument` est dérivée de `typeDocument`
// via FAMILLE_PAR_TYPE_DOCUMENT ci-dessous, jamais de `categorie` : les deux vocabulaires ne se
// recouvrent pas terme à terme (ex. "technique"/"commercial" n'existent pas ici, "parties"/
// "transaction"/"financement"/"notaire" n'existent pas dans `categorie`) — les unifier aurait
// exigé de migrer les valeurs déjà en base, hors périmètre de cette passe.
export type FamilleDocument =
  | "parties"
  | "bien"
  | "diagnostics"
  | "copropriete"
  | "transaction"
  | "financement"
  | "notaire"
  | "autre";

export const LABEL_FAMILLE_DOCUMENT: Record<FamilleDocument, string> = {
  parties: "Parties",
  bien: "Bien",
  diagnostics: "Diagnostics",
  copropriete: "Copropriété",
  transaction: "Transaction",
  financement: "Financement",
  notaire: "Notaire",
  autre: "Autre",
};

// Vocabulaire technique Atlas (ADR-029) — une liste PRODUIT fermée, destinée à donner une
// orthographe stable à un type de pièce donné (jamais "PV AG 2024"/"pv-ag"/"proces verbal AG"
// coexistant librement). Ce n'est PAS une affirmation d'exhaustivité juridique : reprend le
// retour terrain d'une clerc de notaire (copropriété notamment) sans aucune validation officielle
// des obligations correspondantes. `autre` + `typeDocumentDetail` (texte libre) couvrent tout ce
// qui n'est pas encore dans cette liste, même patron que origineLead/origineLeadDetail (ADR-027).
export type TypeDocument =
  // Parties
  | "cni"
  | "justificatif_domicile"
  | "rib"
  // Bien
  | "titre_propriete"
  | "plan"
  | "taxe_fonciere"
  // Diagnostics
  | "dpe"
  | "amiante"
  | "plomb"
  | "electricite"
  | "gaz"
  | "carrez"
  | "termites"
  | "erp"
  | "assainissement"
  // Copropriété
  | "reglement_copropriete"
  | "edd"
  | "pv_ag"
  | "pre_etat_date"
  | "fiche_synthetique"
  | "carnet_entretien"
  | "procedures_syndic"
  // Transaction
  | "mandat"
  | "offre_achat"
  | "compromis"
  | "avenant"
  // Financement
  | "attestation_financement"
  | "offre_pret"
  // Notaire
  | "courrier_notaire"
  | "projet_acte"
  // Autre
  | "autre";

export const FAMILLE_PAR_TYPE_DOCUMENT: Record<TypeDocument, FamilleDocument> = {
  cni: "parties",
  justificatif_domicile: "parties",
  rib: "parties",
  titre_propriete: "bien",
  plan: "bien",
  taxe_fonciere: "bien",
  dpe: "diagnostics",
  amiante: "diagnostics",
  plomb: "diagnostics",
  electricite: "diagnostics",
  gaz: "diagnostics",
  carrez: "diagnostics",
  termites: "diagnostics",
  erp: "diagnostics",
  assainissement: "diagnostics",
  reglement_copropriete: "copropriete",
  edd: "copropriete",
  pv_ag: "copropriete",
  pre_etat_date: "copropriete",
  fiche_synthetique: "copropriete",
  carnet_entretien: "copropriete",
  procedures_syndic: "copropriete",
  mandat: "transaction",
  offre_achat: "transaction",
  compromis: "transaction",
  avenant: "transaction",
  attestation_financement: "financement",
  offre_pret: "financement",
  courrier_notaire: "notaire",
  projet_acte: "notaire",
  autre: "autre",
};

export const TYPES_DOCUMENT = Object.keys(FAMILLE_PAR_TYPE_DOCUMENT) as TypeDocument[];

export const LABEL_TYPE_DOCUMENT: Record<TypeDocument, string> = {
  cni: "Pièce d'identité",
  justificatif_domicile: "Justificatif de domicile",
  rib: "RIB",
  titre_propriete: "Titre de propriété",
  plan: "Plan",
  taxe_fonciere: "Taxe foncière",
  dpe: "DPE",
  amiante: "Amiante",
  plomb: "Plomb",
  electricite: "Électricité",
  gaz: "Gaz",
  carrez: "Métrage Carrez",
  termites: "Termites",
  erp: "État des risques (ERP)",
  assainissement: "Assainissement",
  reglement_copropriete: "Règlement de copropriété",
  edd: "État descriptif de division (EDD/EDDV)",
  pv_ag: "PV d'assemblée générale",
  pre_etat_date: "Pré-état daté",
  fiche_synthetique: "Fiche synthétique",
  carnet_entretien: "Carnet d'entretien",
  procedures_syndic: "Procédures en cours (syndic)",
  mandat: "Mandat",
  offre_achat: "Offre d'achat",
  compromis: "Compromis",
  avenant: "Avenant",
  attestation_financement: "Attestation de financement",
  offre_pret: "Offre de prêt",
  courrier_notaire: "Courrier du notaire",
  projet_acte: "Projet d'acte",
  autre: "Autre",
};

// État de VÉRIFICATION DU CLASSEMENT d'un document (ADR-029) — un jugement du conseiller sur le
// rattachement/classement lui-même, distinct et jamais confondu avec l'état de contrôle d'une
// exigence de checklist (present/manquant/a_verifier/non_applicable/perime/incoherent), qui reste
// entièrement dérivé à la lecture (src/lib/documents/checklistDossier.ts) et n'est jamais stocké.
// 'rejete' : classement explicitement signalé incorrect par le conseiller — jamais déduit
// automatiquement (aucun OCR/LLM, ADR-029). Le moteur de checklist lit cette colonne comme une
// des entrées de son calcul (un document 'rejete' ne compte jamais comme 'present').
export type EtatVerificationDocument = "non_verifie" | "confirme" | "a_verifier" | "rejete";

export const LABEL_ETAT_VERIFICATION_DOCUMENT: Record<EtatVerificationDocument, string> = {
  non_verifie: "Non vérifié",
  confirme: "Confirmé",
  a_verifier: "À vérifier",
  rejete: "Rejeté",
};

// cleStockage est un identifiant opaque généré côté serveur (src/lib/stockageDocuments.ts),
// jamais dérivé d'un nom fourni par l'utilisateur — voir ADR-013 (stockage local V1).
//
// Séparation immutabilité/correction (ADR-029) : nomFichierOriginal/cleStockage/tailleOctets/
// typeMime/creeLe décrivent le FICHIER réellement reçu et restent immuables (ADR-013, aucune
// ré-upload). Tous les autres champs sont des métadonnées de CLASSEMENT/RATTACHEMENT, corrigibles
// sans toucher au fichier via documentBienRepository.corrigerClassementDocumentBien (remplacement
// complet, jamais un patch partiel — voir ChampsCorrectionDocumentBien).
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
  typeDocument?: TypeDocument;
  typeDocumentDetail?: string;
  dateDocument?: string;
  dateFinValidite?: string;
  compromisId?: string;
  acquereurId?: string;
  prospectVendeurId?: string;
  coproprieteDeclaree?: string;
  adresseDeclaree?: string;
  provenance?: string;
  etatVerification: EtatVerificationDocument;
  modifieLe?: string;
};

// Correction de classement (ADR-029) : remplacement complet des champs corrigibles, même contrat
// que ChampsCorrectionRemuneration (ADR-021) — un champ nullable en `string | null` explicite
// (jamais optionnel) pour qu'une remise à NULL soit distinguable d'un "ne pas toucher" qui
// n'existe pas dans cette API. bienId/nom/categorie/etatVerification restent obligatoires (jamais
// vidés) ; les rattachements et dates métier peuvent explicitement repasser à NULL.
export type ChampsCorrectionDocumentBien = {
  bienId: string;
  nom: string;
  categorie: CategorieDocument;
  typeDocument: TypeDocument | null;
  typeDocumentDetail: string | null;
  dateDocument: string | null;
  dateFinValidite: string | null;
  compromisId: string | null;
  acquereurId: string | null;
  prospectVendeurId: string | null;
  coproprieteDeclaree: string | null;
  adresseDeclaree: string | null;
  provenance: string | null;
  etatVerification: EtatVerificationDocument;
};
