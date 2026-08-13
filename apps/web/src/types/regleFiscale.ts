// ADR-023, point 4/5. Uniquement des paramètres légaux datés — jamais un algorithme (voir
// schema.ts, regle_fiscale). valeur est toujours un entier exact, jamais un flottant JS.
export type UniteRegleFiscale = "centimes" | "points_base" | "jours";
export type StatutVerificationRegle = "verifie_direct" | "recoupement" | "a_confirmer";

// Convention temporelle : [dateDebutValidite, dateFinValidite[ — fin exclue, undefined = pas de
// fin connue.
export type RegleFiscale = {
  id: string;
  code: string;
  categorieActivite: string;
  valeur: number;
  unite: UniteRegleFiscale;
  dateDebutValidite: string;
  dateFinValidite?: string;
  sourceLibelle: string;
  sourceUrl: string;
  datePublicationSource?: string;
  statutVerification: StatutVerificationRegle;
  creeLe: string;
};

export type NouvelleRegleFiscale = Omit<RegleFiscale, "id" | "creeLe">;
