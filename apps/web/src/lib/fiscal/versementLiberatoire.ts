import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { resoudreRegle } from "@/lib/referentielFiscalRepository";
import { chargerRfrFoyer } from "@/lib/rfrFoyerRepository";
import { resoudreAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import { appliquerTauxPointsBase, diviserEntier } from "@/lib/fiscal/arithmetiqueFiscale";
import { construireResultatFiscal, provenanceDe, type IssueTranche } from "@/lib/fiscal/resolutionTranche";
import type { TrancheAssiette } from "@/lib/fiscal/assietteAnnuelle";
import type { ProfilFiscal } from "@/types/profilFiscal";
import type { ProvenanceRegle, RaisonIndisponibilite, ResultatFiscal } from "@/types/resultatFiscal";

const CATEGORIE_ACTIVITE = "agent_commercial_immobilier";
const CODE_TAUX_VFL = "taux_versement_liberatoire_bnc";
const CODE_SEUIL_RFR = "seuil_rfr_versement_liberatoire_par_part";

// ADR-024, correction obligatoire n° 2/3 : le VFL n'est appliqué que si le profil l'indique
// explicitement actif à la date de la tranche — jamais déduit du RFR, jamais appliqué à un régime
// hors micro-BNC (le VFL n'existe pas légalement en déclaration contrôlée).
function vflActif(profil: ProfilFiscal): boolean {
  return profil.regimeFiscal === "micro_bnc" && profil.optionVersementLiberatoire === true;
}

// Contrairement aux autres moteurs micro, une tranche pour laquelle le VFL n'est simplement pas
// actif n'est pas une erreur (`undefined` : hors périmètre de ce calcul, exclue silencieusement,
// jamais comptée comme 0 fautif) — seule l'absence de règle alors que le VFL EST actif est une
// vraie raison d'indisponibilité.
async function resoudreTrancheVfl(
  dossierFiscalId: string,
  annee: number,
  tranche: TrancheAssiette
): Promise<IssueTranche | undefined> {
  if (tranche.origine === "remuneration_atlas") {
    const profil = await chargerProfilFiscalADate(dossierFiscalId, tranche.date);
    if (!profil || !vflActif(profil)) return undefined;
    const regle = await resoudreRegle(CODE_TAUX_VFL, CATEGORIE_ACTIVITE, tranche.date);
    if (!regle) return { ok: false, raison: { type: "regle_absente", code: CODE_TAUX_VFL, date: tranche.date } };
    return {
      ok: true,
      montantCentimes: appliquerTauxPointsBase(tranche.montantCentimes, regle.valeur),
      provenance: provenanceDe(regle),
    };
  }

  const [profilDebut, profilFin] = await Promise.all([
    chargerProfilFiscalADate(dossierFiscalId, tranche.dateDebut),
    chargerProfilFiscalADate(dossierFiscalId, tranche.dateFin),
  ]);
  const actifDebut = !!profilDebut && vflActif(profilDebut);
  const actifFin = !!profilFin && vflActif(profilFin);
  if (!actifDebut && !actifFin) return undefined; // VFL inactif sur toute la période, hors périmètre
  if (actifDebut !== actifFin) {
    return { ok: false, raison: { type: "amorcage_non_ventilable", annee, codeRegle: CODE_TAUX_VFL } };
  }
  const [regleDebut, regleFin] = await Promise.all([
    resoudreRegle(CODE_TAUX_VFL, CATEGORIE_ACTIVITE, tranche.dateDebut),
    resoudreRegle(CODE_TAUX_VFL, CATEGORIE_ACTIVITE, tranche.dateFin),
  ]);
  if (!regleDebut || !regleFin) {
    return {
      ok: false,
      raison: { type: "regle_absente", code: CODE_TAUX_VFL, date: !regleDebut ? tranche.dateDebut : tranche.dateFin },
    };
  }
  if (regleDebut.id !== regleFin.id) {
    return { ok: false, raison: { type: "amorcage_non_ventilable", annee, codeRegle: CODE_TAUX_VFL } };
  }
  return {
    ok: true,
    montantCentimes: appliquerTauxPointsBase(tranche.montantCentimes, regleDebut.valeur),
    provenance: provenanceDe(regleDebut),
  };
}

// Versement libératoire calculé uniquement sur les tranches où le profil l'indique actif — le RFR
// n'intervient jamais ici (voir verifierEligibiliteRfr, fonction séparée ci-dessous).
export async function calculerVersementLiberatoire(
  dossierFiscalId: string,
  annee: number
): Promise<ResultatFiscal<number>> {
  const { assiette, tranches } = await resoudreAssietteAnnuelle(dossierFiscalId, annee);
  const resolutions = await Promise.all(tranches.map((tranche) => resoudreTrancheVfl(dossierFiscalId, annee, tranche)));
  const issues = resolutions.filter((r): r is IssueTranche => r !== undefined);
  return construireResultatFiscal(assiette, issues);
}

export type EligibiliteRfr =
  | { statut: "calcule"; eligible: boolean; rfrParPartCentimes: number; seuilCentimes: number; provenance: ProvenanceRegle }
  | { statut: "indisponible"; raisons: RaisonIndisponibilite[] };

// Contrôle informatif séparé, jamais une entrée du calcul VFL ci-dessus (correction n° 2) : compare
// le RFR du foyer N-2 au seuil par part, par produit en croix entier — aucune division, donc aucun
// arrondi à documenter (rfrFoyerCentimes × 100 comparé à seuil × nombrePartsCentiemes, puisque
// nombrePartsCentiemes est l'expression en centièmes de part, cf. rfr_foyer).
export async function verifierEligibiliteRfr(dossierFiscalId: string, annee: number): Promise<EligibiliteRfr> {
  const anneeRfrAttendue = annee - 2;
  const lignes = await chargerRfrFoyer(dossierFiscalId);
  const ligneRfr = lignes.find((l) => l.anneeRfr === anneeRfrAttendue);
  if (!ligneRfr) {
    return { statut: "indisponible", raisons: [{ type: "rfr_absent", anneeRfrAttendue }] };
  }
  const regle = await resoudreRegle(CODE_SEUIL_RFR, CATEGORIE_ACTIVITE, `${annee}-01-01`);
  if (!regle) {
    return { statut: "indisponible", raisons: [{ type: "regle_absente", code: CODE_SEUIL_RFR, date: `${annee}-01-01` }] };
  }
  const eligible =
    BigInt(ligneRfr.rfrFoyerCentimes) * BigInt(100) <= BigInt(regle.valeur) * BigInt(ligneRfr.nombrePartsCentiemes);
  return {
    statut: "calcule",
    eligible,
    rfrParPartCentimes: diviserEntier(ligneRfr.rfrFoyerCentimes * 100, ligneRfr.nombrePartsCentiemes),
    seuilCentimes: regle.valeur,
    provenance: provenanceDe(regle),
  };
}
