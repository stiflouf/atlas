// ADR-048 — type générique partagé par les fonctions de recherche paginée (biens, acquéreurs,
// prospects vendeurs). `total` est le nombre de lignes correspondant aux filtres, avant
// pagination — jamais le nombre de lignes de la page courante (`lignes.length`).
export type PageResultat<T> = { lignes: T[]; total: number };
