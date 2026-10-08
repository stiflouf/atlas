// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — catégories de personnes concernées, vocabulaire
// fermé.
//
// Issues de l'audit PRIVACY_NOTICE_V1_READINESS_AUDIT, et d'aucune autre source : chacune
// correspond à des données réellement présentes en base, jamais à une catégorie théorique.
//
// `UTILISATEUR` et `CONSEILLER` sont distincts, et la distinction porte : l'utilisateur est la
// personne qui s'authentifie (session, allowlist, connexion Google) ; le conseiller est la personne
// dont le produit traite les données professionnelles et fiscales — mêmes individus aujourd'hui,
// deux rôles que le multi-utilisateur séparera.
export const TYPES_PERSONNE_CONCERNEE = [
  "CONTACT",
  "ACQUEREUR",
  "VENDEUR",
  "PROSPECT_VENDEUR",
  "VISITEUR",
  "CONSEILLER",
  "UTILISATEUR",
  // Personne dont les données apparaissent sans qu'elle soit l'objet du dossier : participant d'un
  // événement d'agenda, destinataire d'un envoi, partie citée dans une pièce. C'est la catégorie
  // que l'information Article 14 visera en priorité.
  "TIERS_INCIDENT",
] as const;

export type TypePersonneConcernee = (typeof TYPES_PERSONNE_CONCERNEE)[number];
