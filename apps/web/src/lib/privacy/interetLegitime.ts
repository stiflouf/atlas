// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — intérêts poursuivis pour les finalités fondées sur
// l'intérêt légitime.
//
// CE FICHIER N'EST PAS UNE MISE EN BALANCE. Il nomme l'intérêt poursuivi, ce qui est le premier
// élément exigé et le seul que le code puisse honnêtement porter. L'analyse de mise en balance —
// nécessité, impact sur les personnes, attentes raisonnables, garanties, alternatives moins
// intrusives — est un travail documentaire qui n'a pas été fait.
//
// D'où `LIA_STATUS = TO_BE_DOCUMENTED`, écrit ici plutôt que sous-entendu : une documentation
// d'intérêt sans balance qui se présenterait comme complète serait plus trompeuse que son absence.

export const LIA_STATUS = "TO_BE_DOCUMENTED" as const;

export type LiaStatus = typeof LIA_STATUS;

export interface InteretLegitimeDocumente {
  readonly cle: string;
  readonly interetPoursuivi: string;
  // Ce que le responsable perdrait sans ce traitement. Utile parce que c'est la question qu'une
  // balance posera en premier.
  readonly consequenceSansTraitement: string;
  readonly liaStatus: LiaStatus;
}

export const INTERETS_LEGITIMES_V1: readonly InteretLegitimeDocumente[] = Object.freeze([
  Object.freeze({
    cle: "BON_VISITE_EVIDENCE",
    interetPoursuivi:
      "Établir la réalité de la visite et l'intervention du professionnel dans la présentation du bien, et permettre l'établissement, l'exercice ou la défense de droits.",
    consequenceSansTraitement:
      "L'intervention du professionnel ne serait pas démontrable, et une contestation ultérieure sur la réalité de la visite ou sur l'origine de la mise en relation ne pourrait pas être instruite.",
    liaStatus: LIA_STATUS,
  }),
  Object.freeze({
    cle: "CRM_RELATIONSHIP",
    interetPoursuivi:
      "Assurer le suivi cohérent de la relation et éviter la perte de l'historique nécessaire à la continuité du service.",
    consequenceSansTraitement:
      "Chaque échange repartirait de zéro : la personne devrait répéter sa demande et ses critères, et les engagements pris ne seraient pas retrouvables.",
    liaStatus: LIA_STATUS,
  }),
  Object.freeze({
    cle: "SECURITY",
    interetPoursuivi: "Protéger l'accès au service et les données qu'il contient.",
    consequenceSansTraitement:
      "Aucun contrôle de l'accès au périmètre de données, et aucune capacité à constater qu'un accès a eu lieu.",
    liaStatus: LIA_STATUS,
  }),
  Object.freeze({
    cle: "THIRD_PARTY_CALENDAR_DATA",
    interetPoursuivi:
      "Rapprocher un événement d'agenda du dossier métier correspondant pour préparer l'activité du conseiller.",
    consequenceSansTraitement:
      "Le rapprochement entre agenda et dossier serait à refaire manuellement à chaque consultation.",
    // Donnée de tiers que la personne n'a pas fournie et dont elle peut ignorer la présence : c'est
    // la finalité dont la balance est la plus délicate, et c'est aussi celle qui appelle une
    // information Article 14.
    liaStatus: LIA_STATUS,
  }),
]);

export function interetLegitime(cle: string): InteretLegitimeDocumente | undefined {
  return INTERETS_LEGITIMES_V1.find((interet) => interet.cle === cle);
}
