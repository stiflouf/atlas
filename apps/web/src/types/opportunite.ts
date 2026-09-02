// VALUE-01 — une opportunité est une situation détectée à partir de faits STRUCTURÉS déjà en base,
// pour laquelle une action identifiable du conseiller peut faire avancer le dossier. Toujours
// dérivée à la lecture, jamais persistée (même principe qu'AlerteCopilote, ADR-026), jamais
// produite par un LLM, jamais assortie d'un score ni d'une probabilité.
//
// Distincte d'AlerteCopilote, qui porte le copilote FISCAL (ADR-026) : son contexte ne connaît ni
// les biens, ni les acquéreurs, ni les prospects. Les deux moteurs cohabitent sans se croiser.

export type TypeOpportunite =
  | "relance_prospect_vendeur"
  | "suivi_visite"
  | "match_a_exploiter"
  | "information_a_verifier";

// Trois niveaux explicables, jamais un score 0–100 : la priorité se lit dans la règle qui l'a
// posée, pas dans un nombre.
export type PrioriteOpportunite = "haute" | "moyenne" | "basse";

// Cible métier réelle, portée par une FK existante — c'est elle qui permet la déduplication avec
// les tâches actives (taches.prospectVendeurId/bienId/acquereurId/visiteId, ADR-028), jamais une
// comparaison de libellés.
export type TypeCibleOpportunite = "prospectVendeur" | "bien" | "acquereur" | "visite";

export type CibleOpportunite = { type: TypeCibleOpportunite; id: string };

export type Opportunite = {
  // Déterministe (`type:cibleType:cibleId[:complement]`), jamais un UUID : deux évaluations du
  // même contexte produisent le même id, ce qui rend le tri stable et la déduplication possible.
  id: string;
  type: TypeOpportunite;
  priorite: PrioriteOpportunite;
  cible: CibleOpportunite;
  // Ce que le conseiller doit faire, en une ligne.
  titre: string;
  // Pourquoi DOMIORA le montre — uniquement des faits vérifiables dans les données. Jamais une
  // intention prêtée au client, jamais une probabilité.
  raison: string;
  // Toujours un parcours DÉJÀ existant : aucune opportunité n'invente d'écran.
  action: { libelle: string; href: string };
  // Ancienneté du fait déclencheur en jours civils, quand elle est réellement calculable.
  depuisJours?: number;
};

export const LABEL_PRIORITE_OPPORTUNITE: Record<PrioriteOpportunite, string> = {
  haute: "À faire maintenant",
  moyenne: "À suivre",
  basse: "À vérifier",
};
