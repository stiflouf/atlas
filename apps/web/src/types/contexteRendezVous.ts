// Classification métier d'un rendez-vous, distincte du TypeRdv "calendrier".
// Pas de correspondance 1:1 avec TypeRdv : par exemple "reunion" (calendrier) devient "autre" ici,
// et un événement générique "evenement" peut être classé dans n'importe laquelle de ces catégories.
export type TypeMetierRdv = "visite" | "estimation" | "appel" | "signature" | "prospection" | "autre";

export type SourceCorrespondance =
  | "assignation_directe" // RendezVous.bien / .client déjà renseigné (mock)
  | "reference_bien" // référence de mandat trouvée dans le texte
  | "adresse_bien" // adresse quasi-identique à un bien connu
  | "adresse_partielle" // recouvrement partiel (rue ou ville, pas les deux)
  | "nom_complet_client" // prénom et nom trouvés
  | "nom_client" // nom seul trouvé
  | "prenom_client" // prénom seul trouvé
  | "type_calendar_connu" // le rendez-vous a déjà un type concret (mock)
  | "mot_cle_type" // mot-clé explicite trouvé dans le titre
  | "aucun_indice"; // aucune règle n'a pu se prononcer

export type CandidatBien = { bienId: string; confidence: number; matchedBy: SourceCorrespondance };
export type CandidatClient = { clientId: string; confidence: number; matchedBy: SourceCorrespondance };
export type CandidatType = { type: TypeMetierRdv; confidence: number; matchedBy: SourceCorrespondance };

// Résultat de la correspondance métier d'un RendezVous. Objet séparé et dérivé — RendezVous
// n'est jamais modifié pour porter cette information : elle appartient à Atlas, pas au calendrier.
export type ContexteRendezVous = {
  rendezVousId: string;
  // Renseigné uniquement si la résolution est non ambiguë (voir lib/matching/resoudre.ts).
  bien?: CandidatBien;
  // Candidats retenus (jusqu'à 3) quand le bien n'a pas pu être résolu sans ambiguïté.
  bienCandidats?: CandidatBien[];
  client?: CandidatClient;
  typeMetier?: CandidatType;
  // Vrai si le bien est ambigu et mérite une confirmation humaine avant d'être exploité.
  necessiteConfirmationBien: boolean;
  // Confiance globale de la résolution métier (bien + client + type combinés), utilisable par
  // l'UI en complément des confiances individuelles pour décider si le contexte vaut la peine
  // d'être exploité du tout.
  overallConfidence: number;
};
