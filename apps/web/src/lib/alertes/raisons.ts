import type { RaisonIndisponibilite } from "@/types/resultatFiscal";

// ResultatFiscal<T>/ResultatMicroBnc/ResultatFranchiseTva/EligibiliteRfr partagent tous la même
// forme sur leurs variantes non "calcule" : un champ `raisons`. Un seul extracteur structurel plutôt
// qu'une fonction par type — aucun des appelants n'a besoin de connaître l'union complète.
export function raisonsDe(resultat: { statut: string; raisons?: RaisonIndisponibilite[] }): RaisonIndisponibilite[] {
  return resultat.raisons ?? [];
}
