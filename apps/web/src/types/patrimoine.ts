export type MonumentProche = {
  reference: string; // référence officielle Mérimée, ex. "PA75110006"
  nom: string; // titre éditorial officiel de la notice, non reformulé
  type?: string; // dénomination officielle de l'édifice, ex. "piscine"
  distanceMetres: number; // à vol d'oiseau
  extraitHistorique?: string; // texte officiel tronqué (2-3 phrases / ~400 caractères), jamais reformulé
  historiqueComplet?: string; // texte officiel intégral, pour un futur "voir plus"
};

export type PatrimoineProximite = {
  monuments: MonumentProche[];
  source: "data_gouv_fr_base_merimee";
  recupereLe: string;
};
