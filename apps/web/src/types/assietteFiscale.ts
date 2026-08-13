// ADR-024. L'assiette annuelle n'est jamais un simple montant : elle porte sa propre traçabilité
// (d'où vient chaque centime) et son état de couverture, jamais réduits à un number par l'appelant.

// Intervalle [debut, fin] pour lequel Atlas ne peut PAS garantir l'exhaustivité du montant connu —
// ce n'est pas "aucune donnée dans cet intervalle" (des encaissements Atlas connus peuvent très
// bien exister à l'intérieur, ils sont alors déjà comptés dans montantConnuCentimes) mais "aucun
// amorçage explicite ne confirme qu'il ne manque rien avant/pendant cette période" (ADR-024, point 1
// des corrections). Ne jamais lire l'absence de PeriodeInconnue comme une preuve d'exhaustivité
// avant d'avoir vérifié couverture === "complete".
export type PeriodeInconnue = { debut: string; fin: string };

// Traçabilité obligatoire de chaque composante du montant connu — jamais un total opaque.
export type OrigineMontant =
  | { source: "historique_amorcage"; montantCentimes: number; jusquAuInclus: string }
  | {
      source: "remuneration_atlas";
      montantCentimes: number;
      nombreEncaissements: number;
      premierEncaissement: string;
      dernierEncaissement: string;
    };

// couverture === "complete" seulement si une ligne historique_amorcage confirme explicitement
// (y compris à 0) la période antérieure à ce qu'Atlas peut observer par lui-même. En son absence,
// même si des encaissements Atlas existent dans la période (comptés dans montantConnuCentimes),
// couverture reste "partielle" : Atlas ne peut jamais déduire un début de couverture du seul fait
// qu'un premier encaissement a été enregistré (ADR-024, correction obligatoire n° 1).
export type AssietteAnnuelle = {
  annee: number;
  montantConnuCentimes: number;
  origines: OrigineMontant[];
  couverture: "complete" | "partielle";
  periodesInconnues: PeriodeInconnue[]; // toujours vide si couverture === "complete"
  dateCalcul: string; // date "aujourd'hui" utilisée pour la résolution — audit/tests
};
