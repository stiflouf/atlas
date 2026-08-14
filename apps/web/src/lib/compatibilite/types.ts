// ADR-034 — moteur canonique et déterministe de compatibilité Bien ↔ Acquéreur. Contrat de
// résultat structuré : aucun score numérique, aucune pondération arbitraire (voir moteur.ts et
// docs/adr/034-compatibilite-bien-acquereur.md).

// 'non_concerne' n'existe qu'au niveau d'un critère — jamais au niveau du statut global. Distingue
// deux situations différentes : une exigence absente côté acquéreur (non_concerne) d'une exigence
// présente mais une information inconnue côté bien (a_verifier). Les deux ne doivent jamais être
// confondues : la première ne dit rien sur le bien, la seconde signale une vérification nécessaire.
export type StatutCritere = "compatible" | "incompatible" | "a_verifier" | "non_concerne";

// Statut global : jamais 'non_concerne' (un dossier dans son ensemble est toujours soit
// compatible, soit incompatible, soit à vérifier — voir agrégation dans moteur.ts).
export type StatutCompatibilite = "compatible" | "incompatible" | "a_verifier";

// `critere` est un identifiant stable (ex. "budget_max", "pieces_min") destiné au code — jamais une
// phrase pensée pour l'affichage. `label` et `explication` sont les seuls champs destinés à l'UI.
// `exigenceAcquereur`/`valeurBien` restent optionnels : certains critères (accessibilite) croisent
// plusieurs champs du bien et n'ont pas de valeur scalaire unique à exposer — `explication` reste
// alors la seule source d'explicabilité pour ce critère.
export type EvaluationCritere = {
  critere: string;
  label: string;
  exigenceAcquereur?: string | number | boolean;
  valeurBien?: string | number | boolean;
  statut: StatutCritere;
  explication: string;
};

export type ResultatCompatibilite = {
  bienId: string;
  acquereurId: string;
  statutGlobal: StatutCompatibilite;
  criteres: EvaluationCritere[];
};

// Libellés d'affichage — jamais un score, jamais présenter 'a_verifier' comme une incompatibilité
// (ADR-034, section 14).
export const LABEL_STATUT_COMPATIBILITE: Record<StatutCompatibilite, string> = {
  compatible: "Compatible",
  incompatible: "Incompatible",
  a_verifier: "À vérifier",
};

export const LABEL_STATUT_CRITERE: Record<StatutCritere, string> = {
  compatible: "Compatible",
  incompatible: "Incompatible",
  a_verifier: "À vérifier",
  non_concerne: "Non concerné",
};
