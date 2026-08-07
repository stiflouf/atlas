export type TypeBien = "appartement" | "maison" | "studio" | "loft" | "local_commercial";
export type StatutMandat = "actif" | "suspendu" | "expire";

export type Bien = {
  id: string;
  reference: string;
  titre: string;
  type: TypeBien;
  adresse: string;
  ville: string;
  codePostal: string;
  surface: number;
  pieces: number;
  prix: number;
  statutMandat: StatutMandat;
  dateMandat: string;
  caracteristiques: string[];
  description: string;
};
