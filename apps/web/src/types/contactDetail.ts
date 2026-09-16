import type { Contact } from "./contact";
import type { StadeProjet } from "./client";
import type { StatutProspectVendeur } from "./prospectVendeur";
import type { RoleContact } from "./rechercheContact";
import type { SensInteraction, TypeInteraction } from "./interaction";
import type { IdentiteContactSnapshot } from "./contactFusion";

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

// ADR-059 — une ancienne fiche DIRECTEMENT absorbée dans ce Contact, lue dans le journal
// `contact_fusions` (jamais reconstituée depuis `contacts.fusionne_dans_contact_id`). L'identité est
// celle que l'absorbé avait AU MOMENT de la fusion (`identite_avant_absorbe`) : c'est ce qui a été
// regroupé, pas ce qu'une ligne dirait aujourd'hui. Rien de technique n'en sort : ni sub, ni ids
// déplacés, ni choix par champ — l'écran nomme, date, et renvoie vers la fiche historique.
export type FusionAbsorbeeContact = {
  // Id de la ligne de journal : clé de rendu stable même si deux lignes visent le même absorbé
  // (le read model ne dédoublonne rien). Jamais affiché.
  fusionId: string;
  contactAbsorbeId: string;
  identiteAbsorbee: IdentiteContactSnapshot;
  fusionneLe: string;
  fusionneParEmail?: string;
};

// ADR-059 — la fiche d'un Contact ABSORBÉ n'est pas une fiche avec des listes vides : c'est un
// autre état, dit explicitement. Union discriminée plutôt que des optionnels sur `ContactDetail` :
// une fiche active ne porte aucune nullable « au cas où », et une fiche absorbée ne charge ni
// projets, ni dossiers, ni interactions — l'historique de la personne continue sur le survivant.
//
// Pour un absorbé, deux ids distincts : `fusionneDansContactId` est le maillon IMMÉDIAT tel qu'il
// est stocké (la trace, jamais compactée) ; `contactActifId` est le Contact ACTIF FINAL, résolu en
// suivant la chaîne (`resoudreContactActif`) — c'est lui que la fiche propose d'ouvrir.
export type ResultatContactDetail =
  | { type: "actif"; detail: ContactDetail }
  | {
      type: "fusionne";
      contact: Contact;
      fusionneDansContactId: string;
      contactActifId: string;
      fusionneLe: string;
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
  // Fusions DIRECTES seulement (B → A) : une chaîne A → B → C se lit de proche en proche, par la
  // fiche de chaque absorbé. Vide pour un Contact qui n'a rien absorbé — aucune section rendue.
  fusionsAbsorbees: FusionAbsorbeeContact[];
};
