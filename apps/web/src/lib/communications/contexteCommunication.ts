// ADR-031 — Emails et relances assistées. Cinq couches strictement séparées : INTENTION (pourquoi
// contacter) / DONNÉES FACTUELLES (ce qu'Atlas sait réellement, jamais inventé) / BROUILLON (texte
// proposé) / VALIDATION HUMAINE (édition libre, aucune trace serveur) / ENVOI (geste explicite du
// conseiller, hors périmètre du moteur — voir mailto.ts). Aucun LLM dans cette passe (ADR-008 :
// toute règle exprimable sur des champs structurés l'est, jamais une extraction de texte libre).

import type { Interet } from "@/types/compteRenduVisite";

export type IntentionCommunication =
  | "relance_prospect_vendeur"
  | "suivi_rdv_estimation"
  | "suivi_acquereur"
  | "suivi_visite"
  | "demande_document_manquant"
  | "relance_piece_a_verifier"
  | "message_compromis"
  | "message_notaire"
  | "retour_vendeur_apres_visite";

export const LABEL_INTENTION_COMMUNICATION: Record<IntentionCommunication, string> = {
  relance_prospect_vendeur: "Relance prospect vendeur",
  suivi_rdv_estimation: "Suivi après rendez-vous d'estimation",
  suivi_acquereur: "Suivi acquéreur",
  suivi_visite: "Suivi après visite",
  demande_document_manquant: "Demande de document manquant",
  relance_piece_a_verifier: "Relance d'une pièce à vérifier",
  message_compromis: "Message lié au compromis",
  message_notaire: "Message destiné au notaire",
  retour_vendeur_apres_visite: "Retour vendeur après visite",
};

// Quatre tons explicites (ADR-031) : varient la formulation du MÊME contenu factuel, jamais les
// faits eux-mêmes. Aucune personnalisation psychologique inférée sur la personne.
export type TonMessage = "professionnel" | "cordial" | "court" | "relance_douce";

export const LABEL_TON_MESSAGE: Record<TonMessage, string> = {
  professionnel: "Professionnel",
  cordial: "Cordial",
  court: "Court",
  relance_douce: "Relance douce",
};

// Un destinataire structurellement résolu — jamais deviné depuis un texte libre. `email` absent
// signifie que l'entité existe mais n'a pas d'adresse renseignée (cas prospectVendeur uniquement,
// acquereurs.email est NOT NULL en base).
export type DestinataireCandidat = {
  type: "prospectVendeur" | "acquereur";
  id: string;
  nom: string;
  prenom?: string;
  email?: string;
};

// Uniquement des champs structurés déjà en base — jamais une valeur inventée. Un champ absent est
// omis du texte généré, jamais remplacé par un espace réservé ou une valeur plausible. Les
// templates ne doivent JAMAIS intégrer le contenu sensible d'un document (ADR-031, correction
// n°4) : `documentLabel` porte uniquement le NOM du type de pièce (ex. "Pré-état daté"), jamais un
// extrait de son contenu.
export type FaitsCommunication = {
  destinataireNom?: string;
  destinatairePrenom?: string;
  bienAdresse?: string;
  dateVisite?: string;
  interetVisite?: string;
  // Valeur technique brute de l'intérêt (ADR-042), distincte d'`interetVisite` (déjà un libellé
  // formaté pour `suivi_visite`, acquéreur) — nécessaire pour que `retour_vendeur_apres_visite`
  // choisisse une formulation dédiée par valeur, jamais un texte affirmatif pour `inconnu`.
  interetVisiteValeur?: Interet;
  dateRdvEstimation?: string;
  montantOffre?: number;
  dateOffre?: string;
  prixConvenuCompromis?: number;
  dateActeCompromis?: string;
  documentLabel?: string;
  documentsAObtenirNotaire?: string[];
  // Texte déjà écrit par le conseiller sur la tâche d'origine — recopié tel quel, jamais
  // réinterprété (ADR-008 : le texte libre reste une mémoire passive, jamais une entrée de règle).
  tacheContexte?: string;
};

export type BrouillonEmail = {
  intention: IntentionCommunication;
  ton: TonMessage;
  destinataireEmail?: string;
  objet: string;
  corps: string;
};

// Fusionne le destinataire choisi (nom/prénom) avec les faits déjà résolus depuis la cible — pure,
// aucune donnée supplémentaire introduite.
export function assemblerFaits(
  candidat: DestinataireCandidat | undefined,
  partiels: Omit<FaitsCommunication, "destinataireNom" | "destinatairePrenom">
): FaitsCommunication {
  return { destinataireNom: candidat?.nom, destinatairePrenom: candidat?.prenom, ...partiels };
}
