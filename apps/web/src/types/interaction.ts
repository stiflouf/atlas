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
  creeLe: string;
};
