import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { appliquerTauxPointsBase } from "@/lib/fiscal/arithmetiqueFiscale";
import {
  resoudreTrancheProjeteeAvecTaux,
  construireResultatFiscalProjete,
  type TrancheProjetee,
  type IssueTrancheProjetee,
} from "@/lib/fiscal/resolutionTrancheProjetee";
import { resoudreRegleProjection, provenanceProjectionDe, valeurDe } from "@/lib/fiscal/resolutionRegleProjection";
import {
  resoudreCode as resoudreCodeCotisations,
  estAcreActif,
  CODE_TAUX_ACRE,
  CATEGORIE_ACTIVITE as CATEGORIE_COTISATIONS,
} from "@/lib/fiscal/cotisationsSociales";
import { resoudreCode as resoudreCodeCfp, CATEGORIE_ACTIVITE as CATEGORIE_CFP } from "@/lib/fiscal/cfp";
import { vflActif, CODE_TAUX_VFL, CATEGORIE_ACTIVITE as CATEGORIE_VFL } from "@/lib/fiscal/versementLiberatoire";
import { CODE_PLAFOND, CATEGORIE_ACTIVITE as CATEGORIE_MICROBNC } from "@/lib/fiscal/microBnc";
import { CODE_SEUIL_BASE, CODE_SEUIL_MAJORE, CATEGORIE_ACTIVITE as CATEGORIE_TVA } from "@/lib/fiscal/franchiseTva";
import type { RegleResolueProjection } from "@/lib/fiscal/resolutionRegleProjection";
import type {
  ConsequencesFiscalesProjetees,
  RaisonIndisponibiliteProjection,
  ResultatFiscalProjete,
  SeuilTvaProjete,
  StatutRegimeMicroBncProjete,
} from "@/types/projectionFiscale";

async function calculerCotisationsProjetees(
  dossierFiscalId: string,
  tranches: TrancheProjetee[]
): Promise<ResultatFiscalProjete<number>> {
  const issues = await Promise.all(
    tranches.map(async (tranche): Promise<IssueTrancheProjetee> => {
      const profil = await chargerProfilFiscalADate(dossierFiscalId, tranche.date);
      if (profil && estAcreActif(profil, tranche.date)) {
        return { ok: false, raison: { type: "regle_absente", code: CODE_TAUX_ACRE, date: tranche.date } };
      }
      return resoudreTrancheProjeteeAvecTaux(dossierFiscalId, tranche, CATEGORIE_COTISATIONS, resoudreCodeCotisations);
    })
  );
  return construireResultatFiscalProjete(issues);
}

async function calculerCfpProjete(dossierFiscalId: string, tranches: TrancheProjetee[]): Promise<ResultatFiscalProjete<number>> {
  const issues = await Promise.all(
    tranches.map((tranche) => resoudreTrancheProjeteeAvecTaux(dossierFiscalId, tranche, CATEGORIE_CFP, resoudreCodeCfp))
  );
  return construireResultatFiscalProjete(issues);
}

async function calculerVflProjete(dossierFiscalId: string, tranches: TrancheProjetee[]): Promise<ResultatFiscalProjete<number>> {
  const resolutions = await Promise.all(
    tranches.map(async (tranche): Promise<IssueTrancheProjetee | undefined> => {
      const profil = await chargerProfilFiscalADate(dossierFiscalId, tranche.date);
      if (!profil || !vflActif(profil)) return undefined; // hors périmètre, jamais compté comme 0 fautif
      const regleProjetee = await resoudreRegleProjection(CODE_TAUX_VFL, CATEGORIE_VFL, tranche.date);
      const valeur = valeurDe(regleProjetee);
      if (valeur === undefined) return { ok: false, raison: { type: "regle_absente", code: CODE_TAUX_VFL, date: tranche.date } };
      return {
        ok: true,
        montantCentimes: appliquerTauxPointsBase(tranche.montantCentimes, valeur),
        provenance: provenanceProjectionDe(regleProjetee),
      };
    })
  );
  const issues = resolutions.filter((r): r is IssueTrancheProjetee => r !== undefined);
  return construireResultatFiscalProjete(issues);
}

async function calculerMicroBncProjete(
  dossierFiscalId: string,
  dateResolution: string,
  montantTotalCentimes: number
): Promise<StatutRegimeMicroBncProjete> {
  const profil = await chargerProfilFiscalADate(dossierFiscalId, dateResolution);
  if (!profil || profil.regimeFiscal !== "micro_bnc") {
    return {
      statut: "indeterminee",
      raisons: [{ type: "regime_non_couvert", regimeFiscal: profil?.regimeFiscal ?? "inconnu", date: dateResolution }],
    };
  }
  const plafondProjete = await resoudreRegleProjection(CODE_PLAFOND, CATEGORIE_MICROBNC, dateResolution);
  const valeurPlafond = valeurDe(plafondProjete);
  if (valeurPlafond === undefined) {
    return { statut: "indeterminee", raisons: [{ type: "regle_absente", code: CODE_PLAFOND, date: dateResolution }] };
  }
  return {
    statut: "connue",
    depasse: montantTotalCentimes > valeurPlafond,
    plafondCentimes: valeurPlafond,
    provenance: provenanceProjectionDe(plafondProjete),
  };
}

async function calculerFranchiseTvaProjetee(
  dossierFiscalId: string,
  dateResolution: string,
  montantTotalCentimes: number
): Promise<SeuilTvaProjete> {
  const profil = await chargerProfilFiscalADate(dossierFiscalId, dateResolution);
  if (!profil || profil.regimeTva !== "franchise") {
    return { statut: "indisponible", raisons: [{ type: "regime_tva_non_supporte", regimeTva: profil?.regimeTva ?? "inconnu" }] };
  }
  const [seuilBaseProjete, seuilMajoreProjete] = await Promise.all([
    resoudreRegleProjection(CODE_SEUIL_BASE, CATEGORIE_TVA, dateResolution),
    resoudreRegleProjection(CODE_SEUIL_MAJORE, CATEGORIE_TVA, dateResolution),
  ]);
  const valeurBase = valeurDe(seuilBaseProjete);
  const valeurMajore = valeurDe(seuilMajoreProjete);
  if (valeurBase === undefined || valeurMajore === undefined) {
    const raisons: RaisonIndisponibiliteProjection[] = [];
    if (valeurBase === undefined) raisons.push({ type: "regle_absente", code: CODE_SEUIL_BASE, date: dateResolution });
    if (valeurMajore === undefined) raisons.push({ type: "regle_absente", code: CODE_SEUIL_MAJORE, date: dateResolution });
    return { statut: "indisponible", raisons };
  }
  return {
    statut: "connue",
    margeAvantSeuilBaseCentimes: valeurBase - montantTotalCentimes,
    margeAvantSeuilMajoreCentimes: valeurMajore - montantTotalCentimes,
    provenanceSeuilBase: provenanceProjectionDe(seuilBaseProjete),
    provenanceSeuilMajore: provenanceProjectionDe(seuilMajoreProjete),
  };
}

// Conséquences fiscales d'une liste de tranches datées (pipeline ou ventilation run-rate) — jamais
// un total unique appliqué au dernier taux (ADR-025, correction n° 4). Réutilise telles quelles les
// gardes de régime exportées par les moteurs ADR-024 (cotisationsSociales/cfp/versementLiberatoire/
// microBnc/franchiseTva) — aucune règle n'est réimplémentée ici, seule la source (resoudreRegle vs
// resoudreRegleProjection) change.
export async function calculerConsequencesFiscalesProjetees(
  dossierFiscalId: string,
  annee: number,
  tranches: TrancheProjetee[]
): Promise<ConsequencesFiscalesProjetees> {
  const montantTotalCentimes = tranches.reduce((somme, t) => somme + t.montantCentimes, 0);
  const dateResolution = `${annee}-12-31`;
  const [cotisations, cfp, vfl, microBnc, franchiseTva] = await Promise.all([
    calculerCotisationsProjetees(dossierFiscalId, tranches),
    calculerCfpProjete(dossierFiscalId, tranches),
    calculerVflProjete(dossierFiscalId, tranches),
    calculerMicroBncProjete(dossierFiscalId, dateResolution, montantTotalCentimes),
    calculerFranchiseTvaProjetee(dossierFiscalId, dateResolution, montantTotalCentimes),
  ]);
  return { cotisations, cfp, vfl, microBnc, franchiseTva };
}

async function regleIdentique(code: string, categorieActivite: string, dateA: string, dateB: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    resoudreRegleProjection(code, categorieActivite, dateA),
    resoudreRegleProjection(code, categorieActivite, dateB),
  ]);
  return identifiantRegle(a) === identifiantRegle(b);
}

function identifiantRegle(r: RegleResolueProjection): string {
  if (r.origine === "officielle") return `officielle:${r.regle.id}`;
  if (r.origine === "hypothese_reconduction") return `hypothese:${r.regleReconduite.id}`;
  return "indisponible";
}

// ADR-025, correction obligatoire n° 4 : un total annuel unique (hypothèse utilisateur) ne peut être
// taxé directement que si le profil ET les règles applicables sont stables du 1er janvier au 31
// décembre de l'année — sinon aucune répartition n'est devinée, chaque composante retourne
// "ventilation_requise" explicitement plutôt qu'un chiffre construit sur le dernier taux connu.
async function hypotheseVentilable(dossierFiscalId: string, annee: number): Promise<boolean> {
  const debut = `${annee}-01-01`;
  const fin = `${annee}-12-31`;
  const [profilDebut, profilFin] = await Promise.all([
    chargerProfilFiscalADate(dossierFiscalId, debut),
    chargerProfilFiscalADate(dossierFiscalId, fin),
  ]);
  if (!profilDebut || !profilFin) return false;
  const profilStable =
    profilDebut.regimeFiscal === profilFin.regimeFiscal &&
    profilDebut.regimeTva === profilFin.regimeTva &&
    profilDebut.affiliationRetraite === profilFin.affiliationRetraite &&
    profilDebut.optionVersementLiberatoire === profilFin.optionVersementLiberatoire;
  if (!profilStable) return false;

  const codesAVerifier = [CODE_PLAFOND, CODE_SEUIL_BASE, CODE_SEUIL_MAJORE];
  if (profilDebut.regimeFiscal === "micro_bnc" && profilDebut.affiliationRetraite === "ssi_regime_general") {
    codesAVerifier.push("taux_cotisations_bnc_general");
  }
  if (profilDebut.regimeFiscal === "micro_bnc") codesAVerifier.push("taux_cfp_liberal_non_reglemente");
  if (profilDebut.regimeFiscal === "micro_bnc" && profilDebut.optionVersementLiberatoire) {
    codesAVerifier.push(CODE_TAUX_VFL);
  }

  const identiques = await Promise.all(
    codesAVerifier.map((code) => regleIdentique(code, CATEGORIE_COTISATIONS, debut, fin))
  );
  return identiques.every(Boolean);
}

// Hypothèse utilisateur ADR-025 : temporaire, jamais persistée (correction n° 5) — construite depuis
// un montant annuel saisi à la volée. Si le profil/les règles ne sont pas stables toute l'année,
// aucune composante n'est calculée : "ventilation_requise" explicite plutôt qu'une répartition
// devinée du montant.
export async function calculerConsequencesFiscalesHypothese(
  dossierFiscalId: string,
  annee: number,
  montantAnnuelCentimes: number
): Promise<ConsequencesFiscalesProjetees> {
  const ventilable = await hypotheseVentilable(dossierFiscalId, annee);
  if (!ventilable) {
    const raisons: RaisonIndisponibiliteProjection[] = [{ type: "ventilation_requise", annee }];
    const indisponible = { statut: "indisponible" as const, raisons };
    return {
      cotisations: indisponible,
      cfp: indisponible,
      vfl: indisponible,
      microBnc: { statut: "indeterminee", raisons },
      franchiseTva: { statut: "indisponible", raisons },
    };
  }
  return calculerConsequencesFiscalesProjetees(dossierFiscalId, annee, [
    { montantCentimes: montantAnnuelCentimes, date: `${annee}-12-31` },
  ]);
}
