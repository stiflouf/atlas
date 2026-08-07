export type TypeRdv = "visite" | "estimation" | "appel" | "signature" | "reunion";
export type PrioriteRelance = "haute" | "normale";
export type TypeAction = "appel" | "message" | "email";

export type RendezVous = {
  id: string;
  heure: string;
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
