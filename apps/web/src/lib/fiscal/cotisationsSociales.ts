import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { resoudreAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import {
  construireResultatFiscal,
  resoudreTrancheAvecTaux,
  type IssueTranche,
  type ResoudreCode,
} from "@/lib/fiscal/resolutionTranche";
import type { TrancheAssiette } from "@/lib/fiscal/assietteAnnuelle";
import type { ProfilFiscal } from "@/types/profilFiscal";
import type { ResultatFiscal } from "@/types/resultatFiscal";

const CATEGORIE_ACTIVITE = "agent_commercial_immobilier";
// Nom de code documentaire uniquement : aucune ligne regle_fiscale ne porte ce code aujourd'hui
// (ADR-023 : barème ACRE volontairement non seedé, aucune valeur vérifiée pendant l'audit). Utilisé
// pour que la raison "regle_absente" pointe vers un identifiant stable plutôt qu'un texte libre.
const CODE_TAUX_ACRE = "taux_acre_micro_entrepreneur";

// ADR-024, correction obligatoire n° 2 : seul le régime micro-BNC est couvert par le taux de
// cotisations sociales micro-entrepreneur seedé (`taux_cotisations_bnc_general`) — jamais appliqué
// à une déclaration contrôlée, dont le calcul des cotisations suit un mécanisme entièrement
// différent (assiette nette après charges, pas un pourcentage direct des recettes), hors périmètre
// V1. L'affiliation retraite détermine ensuite le code : seul le régime général est couvert
// aujourd'hui — la Cipav retourne `undefined` (aucun code correspondant n'existe dans le
// référentiel seedé), ce qui se traduit par `regime_non_couvert` plutôt que par une approximation
// via le taux du régime général.
const resoudreCode: ResoudreCode = (profil) => {
  if (profil.regimeFiscal !== "micro_bnc") return undefined;
  if (profil.affiliationRetraite === "ssi_regime_general") return "taux_cotisations_bnc_general";
  return undefined; // cipav / inconnu : aucun code couvert en V1
};

function estAcreActif(profil: ProfilFiscal, date: string): boolean {
  if (!profil.acreActif) return false;
  if (profil.acreDateDebut && date < profil.acreDateDebut) return false;
  if (profil.acreDateFin && date > profil.acreDateFin) return false;
  return true;
}

// ACRE n'a aucun code dans le référentiel (ADR-023, absence volontaire). Une tranche pour laquelle
// l'ACRE est active à sa date — ou active à l'une des deux bornes d'une tranche d'amorçage — retourne
// `regle_absente` plutôt que le taux plein : le moteur ne doit jamais taxer une période ACRE au
// taux normal faute de mieux. Vérification défensive à l'intérieur d'une tranche d'amorçage : la
// couverture n'a pas de granularité journalière, une activation ACRE strictement interne à la
// période (ni à son début ni à sa fin) resterait indétectable — limite documentée (docs/adr/024).
async function resoudreTrancheCotisations(
  dossierFiscalId: string,
  annee: number,
  tranche: TrancheAssiette
): Promise<IssueTranche> {
  if (tranche.origine === "remuneration_atlas") {
    const profil = await chargerProfilFiscalADate(dossierFiscalId, tranche.date);
    if (profil && estAcreActif(profil, tranche.date)) {
      return { ok: false, raison: { type: "regle_absente", code: CODE_TAUX_ACRE, date: tranche.date } };
    }
    return resoudreTrancheAvecTaux(dossierFiscalId, annee, tranche, CATEGORIE_ACTIVITE, resoudreCode);
  }

  const [profilDebut, profilFin] = await Promise.all([
    chargerProfilFiscalADate(dossierFiscalId, tranche.dateDebut),
    chargerProfilFiscalADate(dossierFiscalId, tranche.dateFin),
  ]);
  const acreDetectee =
    (profilDebut && estAcreActif(profilDebut, tranche.dateDebut)) || (profilFin && estAcreActif(profilFin, tranche.dateFin));
  if (acreDetectee) {
    return { ok: false, raison: { type: "regle_absente", code: CODE_TAUX_ACRE, date: tranche.dateFin } };
  }
  return resoudreTrancheAvecTaux(dossierFiscalId, annee, tranche, CATEGORIE_ACTIVITE, resoudreCode);
}

// Cotisations sociales dues sur les encaissements connus de l'année, rattachées tranche par tranche
// à la règle légale applicable à leur date (jamais un taux unique appliqué au total annuel).
export async function calculerCotisationsSociales(
  dossierFiscalId: string,
  annee: number
): Promise<ResultatFiscal<number>> {
  const { assiette, tranches } = await resoudreAssietteAnnuelle(dossierFiscalId, annee);
  const issues = await Promise.all(tranches.map((tranche) => resoudreTrancheCotisations(dossierFiscalId, annee, tranche)));
  return construireResultatFiscal(assiette, issues);
}
