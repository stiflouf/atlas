// VALUE-06 — repère relationnel d'un acquéreur : une information que le CONSEILLER a explicitement
// enregistrée parce qu'elle peut améliorer la qualité de la relation. Jamais une impression
// psychologique, un score, un diagnostic, ni une donnée extraite d'un texte libre (ADR-008 : aucune
// règle ne lit `acquereurs.notes`, `acquereurs.criteres`, `comptesRendusVisite.retour` ou
// `taches.contexte`). La V1 n'a aucun chemin de création automatique : ni NLP, ni regex, ni LLM.

// Quatre catégories, délibérément peu nombreuses. `projet` a été écartée de la V1 : budget,
// secteurs, pièces, surface, extérieur, parking et accessibilité possèdent déjà des colonnes
// canoniques (`acquereurs.*`, `secteurs_recherche_acquereur`) — un repère libre y créerait une
// seconde vérité sur le projet immobilier, que le moteur de compatibilité (ADR-034) ne lirait
// jamais.
export const CATEGORIES_REPERE_RELATIONNEL = [
  "preference_contact",
  "preference_relationnelle",
  "centre_interet",
  "autre",
] as const;

export type CategorieRepereRelationnel = (typeof CATEGORIES_REPERE_RELATIONNEL)[number];

export const LABEL_CATEGORIE_REPERE_RELATIONNEL: Record<CategorieRepereRelationnel, string> = {
  preference_contact: "Préférence de contact",
  preference_relationnelle: "Préférence relationnelle",
  centre_interet: "Centre d'intérêt",
  autre: "Autre repère",
};

// D'où vient l'information, jamais une traçabilité technique : trois valeurs, aucune relation
// obligatoire vers une visite, une note ou un email en V1. La question à laquelle ce champ répond
// est « comment le sais-je ? », pas « quelle ligne de quelle table ».
export const PROVENANCES_REPERE_RELATIONNEL = [
  "indique_par_le_client",
  "observe_lors_d_un_echange",
  "saisi_par_le_conseiller",
] as const;

export type ProvenanceRepereRelationnel = (typeof PROVENANCES_REPERE_RELATIONNEL)[number];

export const LABEL_PROVENANCE_REPERE_RELATIONNEL: Record<ProvenanceRepereRelationnel, string> = {
  indique_par_le_client: "Indiqué par le client",
  observe_lors_d_un_echange: "Observé lors d'un échange",
  saisi_par_le_conseiller: "Ajouté par le conseiller",
};

// Un repère est une phrase courte relue d'un coup d'œil, jamais un paragraphe : garde-fou de
// saisie, pas une règle métier. Une information longue reste une note (`acquereurs.notes`).
export const LONGUEUR_MAX_LIBELLE_REPERE = 200;

export type RepereRelationnel = {
  id: string;
  acquereurId: string;
  categorie: CategorieRepereRelationnel;
  libelle: string;
  provenance: ProvenanceRepereRelationnel;
  // `true` signifie UNIQUEMENT « ce repère PEUT être considéré par une future fonction de
  // personnalisation ». Jamais : l'utiliser systématiquement, l'afficher au client, le transmettre
  // à un modèle de rédaction, l'envoyer automatiquement. VALUE-06 ne consomme aucun repère — les
  // listes blanches de VALUE-04 (`FaitsPartageablesAcquereur`) et VALUE-05
  // (`FaitsAutorisesRedaction`) restent fermées par le type et ne mentionnent aucun repère.
  utilisableCommunication: boolean;
  // Patron ADR-012 : jamais de DELETE utilisateur. Un repère archivé disparaît de la mémoire
  // active et n'est jamais utilisable en communication, quelle que soit `utilisableCommunication`.
  archiveLe?: string;
  creeLe: string;
  // Patron ADR-029/ADR-021 : posé uniquement par une correction, la valeur courante fait foi,
  // aucun historique de versions en V1.
  modifieLe?: string;
};

export function estCategorieRepereRelationnel(valeur: string): valeur is CategorieRepereRelationnel {
  return (CATEGORIES_REPERE_RELATIONNEL as readonly string[]).includes(valeur);
}

export function estProvenanceRepereRelationnel(valeur: string): valeur is ProvenanceRepereRelationnel {
  return (PROVENANCES_REPERE_RELATIONNEL as readonly string[]).includes(valeur);
}
