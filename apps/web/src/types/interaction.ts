// ADR-055 §G — l'INTERACTION : un échange humain avec une personne.
//
// Ce type décrit ce qui s'est passé dans la RELATION. Il ne décrit ni un fait du domaine
// (`evenements_metier` : « mandat signé »), ni une intention future (`taches` : « rappeler
// demain »), ni un enregistrement métier structuré (`comptes_rendus_visite`). Les trois frontières
// sont documentées dans DATA_MODEL.md et verrouillées par un test structurel.
//
// `workspaceId` n'apparaît pas : l'interaction est une feuille de `contacts`, son périmètre est
// celui du contact (ADR-054 §7).
export type TypeInteraction = "appel" | "email" | "sms" | "rendez_vous" | "message" | "note";

// `entrant` / `sortant` décrivent qui a initié ; `interne` décrit une trace que le conseiller pose
// pour lui-même. Absent quand aucun des trois n'est vrai — un rendez-vous n'est ni reçu, ni émis,
// ni interne.
export type SensInteraction = "entrant" | "sortant" | "interne";

// SELLER_FEEDBACK_INTERACTION_V1 (ADR-063) — NATURE MÉTIER, distincte du CANAL (`TypeInteraction`
// ci-dessus) : un même fait ("retour vendeur fait") peut survenir par appel, email ou SMS. Vocabulaire
// fermé, volontairement réduit à une seule valeur en V1 — jamais déduit du texte de `contenu`
// (ADR-008).
export type NatureMetierInteraction = "retour_vendeur_post_visite";

export const LABEL_NATURE_METIER_INTERACTION: Record<NatureMetierInteraction, string> = {
  retour_vendeur_post_visite: "Retour vendeur après visite",
};

export type Interaction = {
  id: string;
  contactId: string;
  type: TypeInteraction;
  sens?: SensInteraction;
  // Quand l'échange a EU LIEU — jamais quand DOMIORA l'a enregistré (voir `creeLe`).
  survenuLe: string;
  // Texte libre, jamais lu par un moteur de règles (ADR-008).
  contenu?: string;
  // Au plus un contexte. Absent = l'échange n'était rattaché à aucun dossier, ce qui reste un fait
  // relationnel valide.
  projetAcquereurId?: string;
  projetVendeurId?: string;
  bienId?: string;
  // SELLER_FEEDBACK_INTERACTION_V1 — 4e contexte possible, mutuellement exclusif avec les trois
  // ci-dessus.
  visiteId?: string;
  natureMetier?: NatureMetierInteraction;
  creeLe: string;
};

export const LABEL_TYPE_INTERACTION: Record<TypeInteraction, string> = {
  appel: "Appel",
  email: "Email",
  sms: "SMS",
  rendez_vous: "Rendez-vous",
  message: "Message",
  note: "Note",
};

export const LABEL_SENS_INTERACTION: Record<SensInteraction, string> = {
  entrant: "entrant",
  sortant: "sortant",
  interne: "interne",
};
