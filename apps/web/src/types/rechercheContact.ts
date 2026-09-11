import type { StadeProjet } from "./client";
import type { StatutProspectVendeur } from "./prospectVendeur";

// ADR-058 — le contrat de SORTIE de la recherche de personnes. Une ligne par Contact, quels que
// soient ses rôles et le nombre de ses projets : c'est toute la décision, exprimée en type.
//
// Volontairement ABSENTS : toute notion de fournisseur ou de référence externe (la recherche lit le
// Core, elle ignore d'où vient un contact), le détail des projets, la liste des interactions et les
// tâches. Le résultat sert à RECONNAÎTRE une personne et à naviguer ; le détail appartiendra à sa
// fiche. Les poser ici obligerait à les charger pour chaque ligne d'une page de résultats.

// Dérivé de `parties_projet`, jamais stocké sur le contact (ADR-055 §A : un contact n'a pas de rôle,
// il a des relations qui en donnent un).
export type RoleContact = "acquereur" | "vendeur";

export type ResumeProjetAcquereur = {
  projetId: string;
  stade: StadeProjet;
  budgetMin: number;
  budgetMax: number;
};

export type ResumeProjetVendeur = {
  projetId: string;
  // Calculé par `deriverStatutProspectVendeur` sur les jalons bruts — jamais réécrit en SQL, jamais
  // stocké (ADR-014 : une seule source de vérité pour un statut dérivé).
  statut: StatutProspectVendeur;
};

export type ResultatRechercheContact = {
  contactId: string;
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  // Ordonnés et sans doublon. Vide pour un contact sans aucune participation — il reste trouvable :
  // la recherche porte sur la personne, pas sur ses dossiers.
  roles: RoleContact[];
  projetsAcquereur: ResumeProjetAcquereur[];
  projetsVendeur: ResumeProjetVendeur[];
  // Absent = aucune interaction enregistrée, jamais une date par défaut.
  derniereInteractionLe?: string;
};

// `hasMore` plutôt qu'un total : aucun écran n'a encore besoin du nombre exact, et un `COUNT(*)`
// global sur chaque frappe coûterait un second balayage pour une information que personne ne lit.
// Obtenu en demandant une ligne de plus que la page.
export type PageRechercheContact = {
  items: ResultatRechercheContact[];
  hasMore: boolean;
};
