import type { TypePersonneConcernee } from "./personnesConcernees";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — politiques de conservation DÉCIDÉES, et rien de plus.
//
// CE FICHIER NE SUPPRIME RIEN. Aucune purge, aucun cron, aucun TTL n'existe dans le produit : la
// doctrine actuelle est la conservation indéfinie, assumée par ADR-012 (« Suppression physique :
// explicitement écartée ») et ADR-013 (« Aucune suppression en V1, ni applicative ni physique »).
// Ce module déclare donc une CIBLE, pas un comportement, et c'est précisément pourquoi la notice
// publique reste désactivée dans ce lot — publier une durée que le produit n'applique pas serait un
// engagement faux.
//
// L'application viendra avec RETENTION_ENFORCEMENT_V1.

// Durée exprimée en unités explicites, jamais en millisecondes : « 3 ans » n'est pas
// 94 672 800 000 ms, et un nombre de jours dérivé d'une année supposée de 365 jours serait déjà une
// approximation inventée.
export type DureeConservation =
  | { readonly unite: "ANNEES"; readonly valeur: number }
  | { readonly unite: "JOURS"; readonly valeur: number }
  | { readonly unite: "MINUTES"; readonly valeur: number }
  // La durée dépend d'un fait extérieur et non d'un compteur : déconnexion, révocation, fermeture
  // du service. Ce n'est pas une absence de politique, c'est une politique sans échéance fixe.
  | { readonly unite: "JUSQU_A_EVENEMENT"; readonly evenement: string };

// Fabriques plutôt que littéraux : `Object.freeze({ unite: "ANNEES", ... })` élargit `unite` en
// `string` et perd l'union discriminante. Elles rendent aussi les politiques ci-dessous lisibles
// d'un coup d'oeil — `annees(3)` au lieu d'un objet à deux champs.
export const annees = (valeur: number): DureeConservation => Object.freeze({ unite: "ANNEES", valeur });
export const jours = (valeur: number): DureeConservation => Object.freeze({ unite: "JOURS", valeur });
export const minutes = (valeur: number): DureeConservation => Object.freeze({ unite: "MINUTES", valeur });
export const jusquAEvenement = (evenement: string): DureeConservation =>
  Object.freeze({ unite: "JUSQU_A_EVENEMENT", evenement });

// L'ÉVÉNEMENT à partir duquel la durée court. Le nommer est indispensable : « 3 ans » n'a aucun
// sens sans dire 3 ans depuis quoi, et deux politiques de même durée mais de point de départ
// différent ne sont pas la même politique.
export const DECLENCHEURS_CONSERVATION = [
  "COLLECTED_AT",
  "LAST_INBOUND_CONTACT_AT",
  "RELATIONSHIP_END_AT",
  "SIGNED_AT",
  "SESSION_CREATED_AT",
  "STATE_ISSUED_AT",
  "DISCONNECT_OR_REVOCATION",
  // Le point de départ dépend de la nature du document et des obligations qui s'y attachent : il
  // ne peut pas être fixé pour la catégorie entière.
  "BY_DOCUMENT_PURPOSE",
] as const;

export type DeclencheurConservation = (typeof DECLENCHEURS_CONSERVATION)[number];

// ACTIVE vs ARCHIVE : la distinction qui empêche la dérive la plus coûteuse de ce domaine.
//
// Une relation close ne justifie pas de conserver l'intégralité du CRM « au cas où ». Les données
// ACTIVES sortent des flux à la clôture ; seules celles réellement nécessaires à une preuve, à une
// obligation applicable ou à la défense de droits passent en ARCHIVE PROBATOIRE — et l'archive
// probatoire n'est pas une base de travail : elle n'alimente ni recherche, ni relance, ni
// statistique.
export type PhaseConservation = "ACTIVE" | "ARCHIVE_PROBATOIRE";

export interface RegleConservation {
  readonly phase: PhaseConservation;
  readonly duree: DureeConservation;
  readonly declencheur: DeclencheurConservation;
}

interface PolitiqueConservationDecidee {
  readonly cle: string;
  readonly statut: "DECIDEE";
  readonly libelle: string;
  readonly personnes: readonly TypePersonneConcernee[];
  readonly regles: readonly RegleConservation[];
  // Une suspension de purge pour contentieux. CONCEPT documenté, non implémenté : il n'existe
  // aujourd'hui ni purge à suspendre, ni marqueur de litige dans le schéma.
  readonly legalHoldApplicable: boolean;
  readonly justification: string;
}

// UNDECIDED est une réponse, pas un trou. Elle dit « cette catégorie existe, sa durée n'est pas
// tranchée, et personne n'a le droit d'en inventer une ». Tant qu'une catégorie indispensable est
// ici, la notice publique reste désactivée.
interface PolitiqueConservationIndecise {
  readonly cle: string;
  readonly statut: "UNDECIDED";
  readonly libelle: string;
  readonly personnes: readonly TypePersonneConcernee[];
  readonly raisonIndecision: string;
}

export type PolitiqueConservation = PolitiqueConservationDecidee | PolitiqueConservationIndecise;

export const POLITIQUES_CONSERVATION_V1: readonly PolitiqueConservation[] = Object.freeze([
  Object.freeze({
    cle: "PROSPECT_MARKETING",
    statut: "DECIDEE",
    libelle: "Prospect non client (prospection commerciale)",
    personnes: Object.freeze<TypePersonneConcernee[]>(["PROSPECT_VENDEUR", "ACQUEREUR", "CONTACT"]),
    regles: Object.freeze<RegleConservation[]>([
      Object.freeze({ phase: "ACTIVE", duree: annees(3), declencheur: "COLLECTED_AT" }),
      // Le dernier contact ÉMANANT du prospect, jamais la dernière sollicitation émise : relancer
      // quelqu'un qui ne répond pas ne prolonge pas la durée pendant laquelle on peut le relancer.
      Object.freeze({ phase: "ACTIVE", duree: annees(3), declencheur: "LAST_INBOUND_CONTACT_AT" }),
    ]),
    legalHoldApplicable: false,
    justification:
      "Trois ans à compter de la collecte ou du dernier contact émanant du prospect, la plus tardive des deux échéances faisant foi.",
  }),
  Object.freeze({
    cle: "CUSTOMER_MARKETING",
    statut: "DECIDEE",
    libelle: "Client — prospection commerciale après la relation",
    personnes: Object.freeze<TypePersonneConcernee[]>(["ACQUEREUR", "VENDEUR", "CONTACT"]),
    regles: Object.freeze<RegleConservation[]>([
      Object.freeze({ phase: "ACTIVE", duree: annees(3), declencheur: "RELATIONSHIP_END_AT" }),
    ]),
    legalHoldApplicable: false,
    justification:
      "Durée de la relation commerciale, puis trois ans après sa fin pour la seule prospection commerciale.",
  }),
  Object.freeze({
    cle: "SIGNED_VISIT_FORM",
    statut: "DECIDEE",
    libelle: "Bon de visite signé (preuve d'intervention)",
    personnes: Object.freeze<TypePersonneConcernee[]>(["VISITEUR"]),
    regles: Object.freeze<RegleConservation[]>([
      Object.freeze({ phase: "ARCHIVE_PROBATOIRE", duree: annees(5), declencheur: "SIGNED_AT" }),
    ]),
    legalHoldApplicable: true,
    // Formulation VOLONTAIREMENT explicite sur ce que « 5 ans » est et n'est pas : c'est une
    // politique probatoire retenue par DOMIORA, cohérente avec le délai civil de droit commun, et
    // en aucun cas une durée légale spéciale propre au bon de visite — il n'en existe pas.
    justification:
      "Cinq ans à compter de la signature : politique de conservation probatoire retenue par DOMIORA, cohérente avec le délai de prescription civile de droit commun. Ce n'est PAS une durée légale obligatoire spéciale du bon de visite, qui n'existe pas. Un contentieux en cours justifie une conservation plus longue (legal hold).",
  }),
  Object.freeze({
    cle: "SESSION",
    statut: "DECIDEE",
    libelle: "Session d'authentification du conseiller",
    personnes: Object.freeze<TypePersonneConcernee[]>(["UTILISATEUR"]),
    regles: Object.freeze<RegleConservation[]>([
      Object.freeze({ phase: "ACTIVE", duree: jours(7), declencheur: "SESSION_CREATED_AT" }),
    ]),
    legalHoldApplicable: false,
    // Seules politiques de ce fichier DÉJÀ appliquées par le produit : le cookie expire de
    // lui-même, sans qu'aucune purge n'ait à passer.
    justification: "Sept jours, déjà appliqué : durée de vie du cookie scellé (sessionAtlas.ts). Aucune table de session.",
  }),
  Object.freeze({
    cle: "OIDC_STATE",
    statut: "DECIDEE",
    libelle: "État OAuth / OIDC à usage unique",
    personnes: Object.freeze<TypePersonneConcernee[]>(["UTILISATEUR"]),
    regles: Object.freeze<RegleConservation[]>([
      Object.freeze({ phase: "ACTIVE", duree: minutes(10), declencheur: "STATE_ISSUED_AT" }),
    ]),
    legalHoldApplicable: false,
    justification: "Dix minutes, déjà appliqué : durée de vie du cookie d'état (atlasOidcState.ts, google/state.ts).",
  }),
  Object.freeze({
    cle: "GOOGLE_CONNECTION",
    statut: "DECIDEE",
    libelle: "Connexion Google du conseiller (refresh token chiffré)",
    personnes: Object.freeze<TypePersonneConcernee[]>(["UTILISATEUR"]),
    regles: Object.freeze<RegleConservation[]>([
      Object.freeze({
        phase: "ACTIVE",
        duree: jusquAEvenement("Déconnexion, révocation côté Google, ou fermeture du compte/service"),
        declencheur: "DISCONNECT_OR_REVOCATION",
      }),
    ]),
    legalHoldApplicable: false,
    justification:
      "Conservée tant que la connexion est active ; supprimée à la déconnexion (supprimerConnexionGoogle). Aucune expiration applicative par ailleurs.",
  }),
  Object.freeze({
    cle: "TRANSACTION_DOCUMENTS",
    statut: "UNDECIDED",
    libelle: "Documents de transaction et pièces du dossier",
    personnes: Object.freeze<TypePersonneConcernee[]>(["VENDEUR", "ACQUEREUR", "VISITEUR"]),
    raisonIndecision:
      "Politique BY_DOCUMENT_PURPOSE : une durée unique pour toute la catégorie serait fausse dans les deux sens. Les obligations propres à chaque type de pièce doivent être recensées avant toute purge, et aucune suppression documentaire n'existe aujourd'hui (ADR-013).",
  }),
  Object.freeze({
    cle: "FREE_TEXT_NOTES",
    statut: "UNDECIDED",
    libelle: "Textes libres : notes, interactions, contexte de tâche",
    personnes: Object.freeze<TypePersonneConcernee[]>(["CONTACT", "ACQUEREUR", "VENDEUR", "PROSPECT_VENDEUR"]),
    // Point important et contre-intuitif : ces champs ne doivent PAS hériter de l'archive
    // probatoire de cinq ans du bon de visite. Leur contenu est imprévisible, non catégorisable, et
    // rien ne démontre qu'il soit nécessaire à une preuve.
    raisonIndecision:
      "Un champ de texte libre peut contenir n'importe quoi et ne bénéficie d'aucune archive probatoire par défaut. Son traitement relève de RETENTION_ENFORCEMENT_V1.",
  }),
  Object.freeze({
    cle: "ACTIVE_CLIENT_OR_PROJECT_DATA",
    statut: "UNDECIDED",
    libelle: "Données de projet / mandat / relation active après clôture",
    personnes: Object.freeze<TypePersonneConcernee[]>(["ACQUEREUR", "VENDEUR", "CONTACT"]),
    raisonIndecision:
      "Conservées pendant la durée nécessaire au projet, au mandat ou à la relation active. À la clôture, le tri entre données actives et archive probatoire reste à écrire, champ par champ : conserver tout le CRM cinq ans par défaut est explicitement refusé.",
  }),
]);

export function politiqueConservation(cle: string): PolitiqueConservation | undefined {
  return POLITIQUES_CONSERVATION_V1.find((politique) => politique.cle === cle);
}

export function politiquesConservationIndecises(): readonly PolitiqueConservation[] {
  return POLITIQUES_CONSERVATION_V1.filter((politique) => politique.statut === "UNDECIDED");
}

// L'APPLICATION effective, distincte de la DÉCISION. Deux politiques seulement s'exécutent
// aujourd'hui, et elles le font par expiration de cookie, non par une purge. Tant que cette
// constante est à false, aucune notice publique n'est activable.
export const RETENTION_ENFORCEMENT_V1_LIVRE = false;
