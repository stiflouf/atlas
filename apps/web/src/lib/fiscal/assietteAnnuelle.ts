import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { chargerCouvertureAnnee } from "@/lib/historiqueAmorcageRepository";
import { listerEncaissementsAnnee } from "@/lib/remunerationRepository";
import type { AssietteAnnuelle, OrigineMontant, PeriodeInconnue } from "@/types/assietteFiscale";

function aujourdHuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function lendemain(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour + 1)).toISOString().slice(0, 10);
}

// Une tranche datée de l'assiette — granularité nécessaire aux moteurs fiscaux (cotisations, CFP,
// VFL) pour rattacher chaque montant à la règle légale applicable à SA date, jamais à un taux
// unique appliqué au total annuel (ADR-024, traitement des changements de taux en cours d'année).
// La tranche `historique_amorcage` porte un intervalle (elle n'a pas de date journalière) ; chaque
// encaissement `remuneration_atlas` porte sa propre date exacte.
export type TrancheAssiette =
  | { origine: "historique_amorcage"; montantCentimes: number; dateDebut: string; dateFin: string }
  | { origine: "remuneration_atlas"; montantCentimes: number; date: string };

// ADR-024, brique n° 1 (assiette annuelle fiable), corrigée après revue architecturale : en
// l'absence de ligne historique_amorcage pour l'année, le premier encaissement Atlas connu n'est
// JAMAIS traité comme un début de couverture. Tous les encaissements Atlas connus de l'année
// entrent dans montantConnuCentimes (y compris le tout premier), mais couverture reste "partielle"
// et periodesInconnues couvre toute la période visible tant qu'aucune ligne d'amorçage explicite
// (y compris à 0, un zéro confirmé) ne vient la borner. Seule une ligne historique_amorcage
// explicite fait basculer couverture à "complete" — jamais une déduction depuis les faits Atlas
// eux-mêmes.
export async function resoudreAssietteAnnuelle(
  dossierFiscalId: string,
  annee: number
): Promise<{ assiette: AssietteAnnuelle; tranches: TrancheAssiette[] }> {
  const dateCalcul = aujourdHuiIso();
  const debutAnnee = `${annee}-01-01`;
  const finAnnee = `${annee}-12-31`;

  const profil = await chargerProfilFiscalADate(dossierFiscalId, finAnnee);
  // dateDebutActivite borne le début de la période à couvrir : avant cette date, il n'y a pas
  // d'activité à couvrir (ce n'est pas une période inconnue, c'est une période sans objet).
  const debutPeriode =
    profil?.dateDebutActivite && profil.dateDebutActivite > debutAnnee ? profil.dateDebutActivite : debutAnnee;
  // Les dates futures ne sont jamais "inconnues" : elles n'ont pas encore eu lieu.
  const finVisible = finAnnee < dateCalcul ? finAnnee : dateCalcul;

  if (debutPeriode > finVisible) {
    return {
      assiette: { annee, montantConnuCentimes: 0, origines: [], couverture: "complete", periodesInconnues: [], dateCalcul },
      tranches: [],
    };
  }

  const couvertureAmorcage = await chargerCouvertureAnnee(dossierFiscalId, annee);
  const tranches: TrancheAssiette[] = [];
  let borneApresAmorcage = debutPeriode;

  if (couvertureAmorcage.connu) {
    tranches.push({
      origine: "historique_amorcage",
      montantCentimes: couvertureAmorcage.montantEncaisseCentimes,
      dateDebut: debutPeriode,
      dateFin: couvertureAmorcage.dateFinCouverture,
    });
    const lendemainCouverture = lendemain(couvertureAmorcage.dateFinCouverture);
    if (lendemainCouverture > borneApresAmorcage) borneApresAmorcage = lendemainCouverture;
  }

  const tousEncaissements = await listerEncaissementsAnnee(annee);
  const encaissementsPertinents = tousEncaissements.filter(
    (e) => e.dateEncaissementReelle >= borneApresAmorcage && e.dateEncaissementReelle <= finVisible
  );
  for (const e of encaissementsPertinents) {
    tranches.push({ origine: "remuneration_atlas", montantCentimes: e.montantCentimes, date: e.dateEncaissementReelle });
  }

  const origines: OrigineMontant[] = [];
  const trancheAmorcage = tranches.find((t) => t.origine === "historique_amorcage");
  if (trancheAmorcage && trancheAmorcage.origine === "historique_amorcage") {
    origines.push({
      source: "historique_amorcage",
      montantCentimes: trancheAmorcage.montantCentimes,
      jusquAuInclus: trancheAmorcage.dateFin,
    });
  }
  if (encaissementsPertinents.length > 0) {
    origines.push({
      source: "remuneration_atlas",
      montantCentimes: encaissementsPertinents.reduce((somme, e) => somme + e.montantCentimes, 0),
      nombreEncaissements: encaissementsPertinents.length,
      premierEncaissement: encaissementsPertinents[0].dateEncaissementReelle,
      dernierEncaissement: encaissementsPertinents[encaissementsPertinents.length - 1].dateEncaissementReelle,
    });
  }

  const montantConnuCentimes = origines.reduce((somme, o) => somme + o.montantCentimes, 0);
  const couverture: AssietteAnnuelle["couverture"] = couvertureAmorcage.connu ? "complete" : "partielle";
  const periodesInconnues: PeriodeInconnue[] = couvertureAmorcage.connu
    ? []
    : [{ debut: debutPeriode, fin: finVisible }];

  return {
    assiette: { annee, montantConnuCentimes, origines, couverture, periodesInconnues, dateCalcul },
    tranches,
  };
}

export async function calculerAssietteAnnuelle(dossierFiscalId: string, annee: number): Promise<AssietteAnnuelle> {
  return (await resoudreAssietteAnnuelle(dossierFiscalId, annee)).assiette;
}
