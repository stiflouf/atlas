import { chargerHistoriqueMensuel } from "@/lib/fiscal/historiqueMensuel";
import { diviserEntier } from "@/lib/fiscal/arithmetiqueFiscale";

// ADR-025, correction obligatoire n° 2. Seuil PRODUIT, assumé et documenté — pas une formule
// statistique dérivée des données : en dessous, une moyenne mensuelle est dominée par 1-2 ventes
// isolées (cycle visite -> encaissement de plusieurs mois, ADR-018) et n'a aucune valeur prédictive
// honnête. Aucune saisonnalité en V1 (nécessiterait au moins 24 mois pour comparer un mois à
// lui-même l'année précédente — hors périmètre).
export const SEUIL_MOIS_MINIMUM_RUN_RATE = 6;

export type FiabiliteRunRate =
  | { fiable: true; moisHistoriqueUtilises: number; moyenneMensuelleCentimes: number }
  | { fiable: false; moisHistoriqueUtilises: number };

// Moyenne sur TOUS les mois garantis disponibles (jamais seulement les 6 derniers) dès que le
// seuil minimal est atteint — plus l'historique s'accumule, plus la moyenne se stabilise. Division
// entière exclusivement (arithmetiqueFiscale.diviserEntier), même garantie que le reste du moteur
// fiscal : aucune donnée monétaire en flottant.
export async function evaluerRunRate(dossierFiscalId: string): Promise<FiabiliteRunRate> {
  const serie = await chargerHistoriqueMensuel(dossierFiscalId);
  if (serie.length < SEUIL_MOIS_MINIMUM_RUN_RATE) {
    return { fiable: false, moisHistoriqueUtilises: serie.length };
  }
  const totalCentimes = serie.reduce((somme, m) => somme + m.montantCentimes, 0);
  return {
    fiable: true,
    moisHistoriqueUtilises: serie.length,
    moyenneMensuelleCentimes: diviserEntier(totalCentimes, serie.length),
  };
}

// ADR-025, correction obligatoire n° 4 : ventilation mensuelle plate (aucune saisonnalité V1) pour
// qu'un changement de taux/régime en cours de l'année cible puisse être appliqué mois par mois,
// jamais un montant annuel unique traité au dernier taux connu.
export function ventilerRunRateSurAnnee(
  annee: number,
  moyenneMensuelleCentimes: number
): { mois: string; montantCentimes: number }[] {
  return Array.from({ length: 12 }, (_, index) => ({
    mois: `${annee}-${String(index + 1).padStart(2, "0")}`,
    montantCentimes: moyenneMensuelleCentimes,
  }));
}
