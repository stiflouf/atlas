export type StatutAction = "a_faire" | "termine";
export type PrioriteAction = "haute" | "normale" | "basse";

export type TypeActionMetier = "appel" | "email" | "message" | "document" | "relance" | "autre";

// Source unique pour toute action métier : c'est à partir de cette structure
// que l'UI dérive la raison pour laquelle un dossier mérite l'attention du
// conseiller, plutôt que de maintenir un texte libre séparé.
// bienId/acquereurId sont indépendants et tous deux optionnels : une action peut
// concerner un bien, un acquéreur, les deux, ou ni l'un ni l'autre (tâche générale).
export type ActionMetier = {
  id: string;
  titre: string;
  contexte?: string;
  statut: StatutAction;
  priorite: PrioriteAction;
  echeance?: string;
  type: TypeActionMetier;
  bienId?: string;
  acquereurId?: string;
  creeLe: string;
  termineLe?: string;
};
