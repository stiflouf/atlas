// Vocabulaire du type de note (ADR-027) — distingue explicitement une vraie interaction vendeur
// d'une remarque interne du conseiller : seules les valeurs de TYPES_NOTE_INTERACTION mettent à
// jour ProspectVendeur.dernierContactLe (voir noteProspectVendeurRepository.
// ajouterNoteProspectVendeur). Prépare la timeline CRM future sans la construire.
export const TYPES_NOTE_PROSPECT_VENDEUR = [
  "appel",
  "email",
  "sms",
  "rendez_vous",
  "autre_interaction",
  "note_interne",
] as const;

export type TypeNoteProspectVendeur = (typeof TYPES_NOTE_PROSPECT_VENDEUR)[number];

export const LABEL_TYPE_NOTE_PROSPECT_VENDEUR: Record<TypeNoteProspectVendeur, string> = {
  appel: "Appel",
  email: "Email",
  sms: "SMS",
  rendez_vous: "Rendez-vous",
  autre_interaction: "Autre interaction",
  note_interne: "Note interne",
};

// note_interne exclu volontairement : append-only comme les autres, mais ne représente aucune
// interaction avec le vendeur (ADR-027, correction n° 2).
export const TYPES_NOTE_INTERACTION: readonly TypeNoteProspectVendeur[] = [
  "appel",
  "email",
  "sms",
  "rendez_vous",
  "autre_interaction",
];

export type NoteProspectVendeur = {
  id: string;
  prospectVendeurId: string;
  type: TypeNoteProspectVendeur;
  contenu: string;
  creeLe: string;
};
