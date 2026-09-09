// ADR-055 §B — la PARTIE DE PROJET : la relation « cette personne participe à ce projet ». C'est
// elle, et elle seule, qui fait exister le rôle — un contact est vendeur parce qu'il est partie
// d'un projet vendeur, acquéreur parce qu'il est partie d'un projet acquéreur. La même personne
// peut donc être les deux à la fois, sans qu'aucune colonne ne l'affirme.
//
// Ce type vit dans son propre module depuis que les deux côtés existent : une relation partagée par
// les projets acquéreur ET vendeur n'appartient plus au vocabulaire de l'un des deux.

// Vocabulaire fermé. Aucun rôle de propriété juridique (`proprietaire`, `mandant`, `indivisaire`,
// `usufruitier`) : ADR-055 §C place ce lien sur le mandat et le projet, et aucun consommateur
// n'existe — l'inventer affirmerait un fait que DOMIORA ne constate pas.
export type RolePartieProjet = "acquereur" | "co_acquereur" | "vendeur" | "co_vendeur";

// EXACTEMENT une cible, garantie par le type comme elle l'est par le `CHECK` en base : jamais zéro,
// jamais deux. Jamais un couple polymorphe { type, id }, écarté par ADR-055 (invariant 5).
export type CiblePartieProjet =
  | { projetAcquereurId: string; projetVendeurId?: never }
  | { projetVendeurId: string; projetAcquereurId?: never };

export type PartieProjet = {
  id: string;
  contactId: string;
  // Une seule des deux est renseignée — l'autre est absente, jamais `null` (même traduction que
  // partout ailleurs : NULL Postgres -> undefined métier).
  projetAcquereurId?: string;
  projetVendeurId?: string;
  role: RolePartieProjet;
  creeLe: string;
};
