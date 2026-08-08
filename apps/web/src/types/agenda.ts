// "evenement" : type générique pour un événement dont on ne connaît pas encore la nature
// (ex. importé depuis un calendrier externe). Pas de déduction depuis le texte pour l'instant —
// la classification viendra dans un sprint dédié.
export type TypeRdv = "visite" | "estimation" | "appel" | "signature" | "reunion" | "evenement";
export type PrioriteRelance = "haute" | "normale";
export type TypeAction = "appel" | "message" | "email";

export type RendezVous = {
  id: string;
  heure: string;
  // Durée en minutes, si connue. Sinon une durée par défaut est utilisée selon le type.
  dureeMinutes?: number;
  // Événement sans heure précise (ex. événement "toute la journée" d'un calendrier externe).
  journeeEntiere?: boolean;
  // Jour calendaire (YYYY-MM-DD, fuseau Europe/Paris) auquel rattacher l'événement.
  // Absent pour les données mockées : elles sont toujours considérées comme "aujourd'hui".
  date?: string;
  type: TypeRdv;
  titre: string;
  lieu?: string;
  bien?: { id: string; adresse: string };
  client?: { id: string; nom: string; prenom: string };
  preparationDisponible: boolean;
};

export type Relance = {
  id: string;
  clientId: string;
  client: { nom: string; prenom: string };
  motif: string;
  priorite: PrioriteRelance;
  joursAttente: number;
  actionSuggeree: string;
  actionType: TypeAction;
  visitId?: string;
};

export type ActionPrevue = {
  id: string;
  label: string;
  contexte?: string;
  echeance?: string;
};
