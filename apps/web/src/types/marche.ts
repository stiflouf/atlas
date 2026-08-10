export type TransactionComparable = {
  dateVente: string; // format ISO (YYYY-MM-DD), tel que fourni par la source
  prixVente: number;
  surfaceM2: number;
  prixM2: number; // calculé : prixVente / surfaceM2, jamais une estimation
  distanceMetres: number; // à vol d'oiseau, depuis le centroïde de la parcelle
  reference: string;
};

export type MarcheProximite = {
  transactions: TransactionComparable[];
  source: string;
  recupereLe: string;
};
