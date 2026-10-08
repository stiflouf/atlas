// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — vocabulaire FERMÉ des bases juridiques, et la
// frontière qui empêche de le confondre avec autre chose.
//
// Quatre valeurs, aucune chaîne libre, aucun repli. Une finalité dont la base n'est pas décidée
// n'en reçoit pas une par défaut : elle est absente de la matrice, et un test le refuse.

export const BASES_LEGALES = [
  // Article 6-1-b : nécessaire à l'exécution d'un contrat OU à des mesures précontractuelles
  // prises à la demande de la personne. Les deux moitiés comptent : une demande entrante
  // d'information sur un bien relève de la seconde, sans qu'aucun contrat n'existe.
  "CONTRACT_OR_PRECONTRACTUAL",
  // Article 6-1-f. Exige un intérêt identifié et une mise en balance — voir `interetLegitime.ts`.
  "LEGITIMATE_INTEREST",
  // Article 6-1-a. N'est utilisé par AUCUNE finalité V1 : le produit ne collecte aujourd'hui aucun
  // consentement au sens du RGPD. La valeur existe pour que la prospection commerciale B2C puisse
  // nommer ce qui lui manquerait, jamais pour qu'une finalité s'en pare.
  "CONSENT",
  // Article 6-1-c. Jamais générique : une sous-finalité précise et le texte qui l'impose doivent
  // être nommés, sans quoi la base est refusée.
  "LEGAL_OBLIGATION",
] as const;

export type BaseLegale = (typeof BASES_LEGALES)[number];

// CE QUI N'EST PAS UNE BASE JURIDIQUE, et pourquoi cette constante existe.
//
// La case du bon de visite — « Je reconnais avoir pris connaissance du présent bon de visite,
// confirme l'exactitude des informations relatives à la visite et appose volontairement ma
// signature. » — est une confirmation de signature d'un DOCUMENT. Elle ne mentionne aucun
// traitement, aucune finalité, aucun destinataire, aucune durée, aucun droit, et personne ne l'a
// présentée comme une information sur un traitement de données.
//
// Elle n'est donc pas, et ne devient jamais, la base juridique du traitement des données du
// signataire. Le nommer ici, hors du type `BaseLegale`, rend la confusion impossible à écrire : ce
// littéral n'est assignable à aucun champ de base légale.
export const DOCUMENT_SIGNATURE_CONSENT = "DOCUMENT_SIGNATURE_CONSENT" as const;

export type DocumentSignatureConsent = typeof DOCUMENT_SIGNATURE_CONSENT;

export function estBaseLegale(valeur: string): valeur is BaseLegale {
  return (BASES_LEGALES as readonly string[]).includes(valeur);
}
