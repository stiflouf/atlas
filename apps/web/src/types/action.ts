export type StatutAction = "a_faire" | "en_cours" | "termine";
export type PrioriteAction = "haute" | "normale" | "basse";

export type TypeActionMetier =
  | "suivi_offre"
  | "relance_client"
  | "administratif"
  | "juridique"
  | "commercial";

export type EntiteConcernee =
  | { type: "bien"; id: string }
  | { type: "client"; id: string };

// Source unique pour toute action métier : c'est à partir de cette structure
// que l'UI dérive la raison pour laquelle un dossier mérite l'attention du
// conseiller, plutôt que de maintenir un texte libre séparé.
export type ActionMetier = {
  id: string;
  titre: string;
  contexte?: string;
  statut: StatutAction;
  priorite: PrioriteAction;
  echeance?: string;
  type: TypeActionMetier;
  entite: EntiteConcernee;
  dateCreation: string;
};
