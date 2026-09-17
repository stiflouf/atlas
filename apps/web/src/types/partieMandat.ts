// ADR-060 §16 — la PARTIE DE MANDAT : « cette personne est partie à ce mandat ». C'est elle qui
// porte la qualité contractuelle de mandant ou de représentant — jamais `parties_projet` (la
// participation à un projet de vente n'est pas la signature d'un contrat), jamais une colonne du
// mandat (un mandat à un seul Contact serait une erreur structurelle : couple, indivision).

// Vocabulaire fermé à deux valeurs, le même que le CHECK en base. `representant` est un Contact
// HUMAIN qui agit pour une SCI, une indivision ou un mandant absent : aucune personne morale, aucune
// entité Organisation (`LEGAL_ENTITY_REQUIRED_V1 = NO`). Rien d'autre n'est soutenu par un usage.
export const ROLES_PARTIE_MANDAT = ["mandant", "representant"] as const;
export type RolePartieMandat = (typeof ROLES_PARTIE_MANDAT)[number];

export function estRolePartieMandat(valeur: unknown): valeur is RolePartieMandat {
  return typeof valeur === "string" && (ROLES_PARTIE_MANDAT as readonly string[]).includes(valeur);
}

export const LABEL_ROLE_PARTIE_MANDAT: Record<RolePartieMandat, string> = {
  mandant: "Mandant",
  representant: "Représentant",
};

// Priorité DÉTERMINISTE des rôles, lue par le moteur de fusion Contact quand deux Contacts fusionnés
// sont parties du même mandat : `mandant` est le rôle contractuel principal, il l'emporte toujours
// sur `representant`. Propre à ce vocabulaire — jamais la priorité de `parties_projet`, dont les
// rôles sont autres. Plus petit = plus fort.
const PRIORITE: Record<RolePartieMandat, number> = { mandant: 0, representant: 1 };

export function prioriteRolePartieMandat(role: RolePartieMandat): number {
  return PRIORITE[role];
}

export function roleRetenuPartieMandat(a: RolePartieMandat, b: RolePartieMandat): RolePartieMandat {
  return prioriteRolePartieMandat(a) <= prioriteRolePartieMandat(b) ? a : b;
}

export type PartieMandat = {
  id: string;
  mandatId: string;
  contactId: string;
  role: RolePartieMandat;
  creeLe: string;
};

// Lecture enrichie pour l'UI future : la partie et l'identité CANONIQUE du Contact (ADR-055 §A),
// obtenue par jointure — jamais un instantané stocké sur la relation.
export type PartieMandatDetail = PartieMandat & {
  contact: {
    id: string;
    nom: string;
    prenom?: string;
    email?: string;
    telephone?: string;
  };
};
