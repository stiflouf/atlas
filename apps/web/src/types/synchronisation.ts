import type { ChampProjetAcquereurModifiable } from "@/types/projetAcquereur";
import type { CibleCanonique, SourceDeVerite } from "@/types/provenance";

// ADR-056 §9 — le contrat d'ENTRÉE du Sync Engine. Une `MutationExterneNormalisee` décrit UNE
// intention de mise à jour, déjà traduite en concepts DOMIORA par l'adaptateur du connecteur.
//
// Ce qu'elle ne transporte JAMAIS (invariants 7 et 9) : payload fournisseur brut, en-têtes HTTP,
// jeton, URL, ou un `data` opaque « au cas où ». Ce qui ne se traduit pas est abandonné par
// l'adaptateur, jamais rangé ici pour être interprété plus tard par le domaine.
//
// La NORMALISATION appartient au connecteur : « 450 000 € » devient `450000` avant d'arriver.
// Le Sync Engine valide le type attendu, il ne convertit rien.

// Périmètre du premier pipeline : le projet acquéreur. Une seule entité, pour prouver la chaîne
// avant de la généraliser.
//
// Les champs synchronisables sont EXACTEMENT ceux que le Core déclare modifiables un par un — pas
// une seconde liste maintenue en parallèle, qui divergerait au premier ajout. La dépendance va dans
// ce sens et jamais dans l'autre : le Core ignore qu'une synchronisation existe (ADR-056 §9).
//
// `stadeProjet` en est donc absent, et c'est heureux : le laisser piloter par une source externe
// ferait reculer un dossier parce qu'un CRM tiers est en retard.
export type ChampSynchronisableProjetAcquereur = ChampProjetAcquereurModifiable;

export type MutationExterneNormalisee = {
  // L'identité chez la source — le SEUL moyen de retrouver l'entité canonique (aucun
  // rapprochement par email, téléphone ou nom : ADR-056 §3, ADR-055 §H).
  fournisseur: string;
  typeEntiteExterne: string;
  idExterne: string;
  // Toujours explicite : ce lot ne traite que le projet acquéreur, mais une mutation dit sur QUOI
  // elle porte plutôt que de le laisser deviner à l'appelant.
  typeEntiteCanonique: "projet_acquereur";
  champ: ChampSynchronisableProjetAcquereur;
  // UNE valeur, explicitement proposée. Un champ absent du payload de la source ne produit
  // simplement AUCUNE mutation — « absent » n'est jamais traduit en `null` (ADR-056, prudence sur
  // les valeurs manquantes).
  valeurExterne: unknown;
  // Date métier du fait chez la source, quand elle est connue. Purement descriptive aujourd'hui :
  // rien ne l'utilise pour arbitrer, et un arbitrage par horodatage serait une résolution
  // automatique de conflit — exactement ce qu'ADR-056 interdit.
  observeeLe?: string;
};

// Le désaccord, rendu OBSERVABLE (ADR-056 invariant 5) : un conflit est un fait, jamais un log
// silencieux, jamais une résolution automatique. Cet objet porte tout ce qu'un humain doit voir
// pour trancher — et rien de secret.
export type ConflitSynchronisation = {
  cible: CibleCanonique;
  champ: string;
  valeurLocale: unknown;
  valeurExterne: unknown;
  fournisseur: string;
  typeEntiteExterne: string;
  idExterne: string;
  sourceDeVerite: SourceDeVerite;
  raison: string;
};

// Résultat DISCRIMINÉ. Aucun de ces états n'est une exception : ce sont des issues normales du
// métier, et les lever ferait perdre à l'appelant l'information qui les distingue. Les exceptions
// restent réservées aux erreurs système et aux invariants impossibles.
export type ResultatApplicationMutation =
  // Écrit. `valeurPrecedente` permet à un futur runner de journaliser ce qui a changé.
  | { statut: "appliquee"; cible: CibleCanonique; champ: string; valeurPrecedente: unknown; valeurAppliquee: unknown }
  // Rien à faire : la valeur canonique dit déjà la même chose. Aucune écriture.
  | { statut: "ignoree"; cible: CibleCanonique; champ: string; valeurLocale: unknown; valeurExterne: unknown; raison: string }
  // Désaccord constaté. Aucune écriture.
  | { statut: "conflit"; conflit: ConflitSynchronisation }
  // L'identité externe n'est rattachée à rien. Ce lot ne CRÉE aucune entité canonique : décider
  // qu'un inconnu mérite une fiche est un geste d'import, avec ses propres règles.
  | { statut: "identite_inconnue"; fournisseur: string; typeEntiteExterne: string; idExterne: string }
  // L'identité est connue mais désigne un autre type d'entité. Aucune conversion automatique.
  | { statut: "cible_inattendue"; cible: CibleCanonique; typeAttendu: string }
  // Le connecteur n'a pas déclaré la capacité d'importer ce type d'entité. L'omission vaut refus.
  | { statut: "capacite_refusee"; fournisseur: string; typeEntiteCanonique: string; raison: string }
  // La valeur proposée n'a pas le type du champ canonique. Postgres n'est pas le premier validateur.
  | { statut: "mutation_invalide"; champ: string; valeurExterne: unknown; raison: string }
  // La valeur est bien typée mais violerait un invariant métier du Core. Rien n'est persisté.
  | { statut: "refus_metier"; champ: string; valeurExterne: unknown; raison: string };
