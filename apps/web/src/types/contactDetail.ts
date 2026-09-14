import type { Contact } from "./contact";
import type { StadeProjet } from "./client";
import type { StatutProspectVendeur } from "./prospectVendeur";
import type { RoleContact } from "./rechercheContact";
import type { SensInteraction, TypeInteraction } from "./interaction";

// ADR-058 — la FICHE d'une personne : ce que la recherche résume, développé pour un seul Contact.
// Lecture seule. Ce type expose ce qu'un écran affiche, jamais toutes les colonnes.
//
// Deux natures de dossier historique, et le type les sépare : un dossier PONTÉ (il décrit un
// projet canonique — `acquereurs.projet_acquereur_id`) est porté par son projet, via `acquereurId`
// / `prospectVendeurId` ; un dossier CONTACT-ONLY (rattaché à la personne sans projet canonique,
// ce que le rattachement assisté autorise — ADR-055 §H) est listé à part. Jamais les deux à la fois
// pour un même dossier.

export type ProjetAcquereurDetail = {
  projetId: string;
  stade: StadeProjet;
  budgetMin: number;
  budgetMax: number;
  criteres: string[];
  creeLe: string;
  archiveLe?: string;
  // Présent uniquement si un dossier historique référence ce projet : c'est le seul id que
  // `/clients/[id]` accepte. Jamais déduit du nom ou de l'email.
  acquereurId?: string;
};

export type ProjetVendeurDetail = {
  projetId: string;
  statut: StatutProspectVendeur;
  creeLe: string;
  archiveLe?: string;
  prospectVendeurId?: string;
  // Lue sur le dossier ponté (ville, sinon secteur, sinon adresse) : le projet canonique ne porte
  // pas encore de localisation.
  localisation?: string;
};

export type DossierAcquereurContactOnly = {
  acquereurId: string;
  stade: StadeProjet;
  budgetMin: number;
  budgetMax: number;
  archiveLe?: string;
};

export type DossierVendeurContactOnly = {
  prospectVendeurId: string;
  statut: StatutProspectVendeur;
  localisation?: string;
  archiveLe?: string;
};

// Au plus un contexte, jamais le contenu complet : la fiche liste, elle ne déroule pas.
export type ContexteInteractionRecente = "projet_acquereur" | "projet_vendeur" | "bien";

export type InteractionRecente = {
  id: string;
  type: TypeInteraction;
  sens?: SensInteraction;
  survenuLe: string;
  contexte?: ContexteInteractionRecente;
};

export type ContactDetail = {
  contact: Contact;
  // Dérivés des projets canoniques, jamais stockés (ADR-055 §A). Vides pour une personne sans
  // projet — sa fiche reste valide.
  roles: RoleContact[];
  projetsAcquereur: ProjetAcquereurDetail[];
  projetsVendeur: ProjetVendeurDetail[];
  dossiersAcquereurContactOnly: DossierAcquereurContactOnly[];
  dossiersVendeurContactOnly: DossierVendeurContactOnly[];
  interactionsRecentes: InteractionRecente[];
};
