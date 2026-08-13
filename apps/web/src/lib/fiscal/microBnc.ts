import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { resoudreRegle } from "@/lib/referentielFiscalRepository";
import { calculerAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import { joursDansAnnee, joursInclusEntre, prorataJours } from "@/lib/fiscal/arithmetiqueFiscale";
import { provenanceDe } from "@/lib/fiscal/resolutionTranche";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";
import type { ProvenanceRegle, RaisonIndisponibilite } from "@/types/resultatFiscal";

// Exportés (ADR-025) pour être réutilisés tels quels par le moteur de projection pluriannuelle.
export const CATEGORIE_ACTIVITE = "agent_commercial_immobilier";
export const CODE_PLAFOND = "plafond_micro_bnc";

export type DonneesAnneeMicroBnc =
  | { statut: "connue"; assiette: AssietteAnnuelle; depasse: boolean }
  | { statut: "indeterminee"; assiette: AssietteAnnuelle };

export type ValeurMicroBnc = {
  plafondPleinCentimes: number;
  provenancePlafond: ProvenanceRegle;
  anneeCourante: DonneesAnneeMicroBnc;
  // ADR-024, correction obligatoire n° 4 : présent uniquement en année de création (dateDebutActivite
  // dans l'année calculée). C'est une valeur ANNUALISÉE DE RÉFÉRENCE nécessaire au mécanisme légal
  // des années de référence (comparaison N/N-1/N-2 à venir en ADR-025+) — jamais un seuil dont le
  // dépassement provoquerait une sortie immédiate du régime micro. `depasse` de anneeCourante compare
  // toujours au plafond PLEIN, jamais à cette valeur de référence.
  anneeCreation: boolean;
  plafondProratiseReferenceCentimes?: number;
  anneeMoins1?: DonneesAnneeMicroBnc;
  anneeMoins2?: DonneesAnneeMicroBnc;
};

export type ResultatMicroBnc =
  | { statut: "calcule"; valeur: ValeurMicroBnc }
  | { statut: "partiel"; valeurConnue: ValeurMicroBnc; raisons: RaisonIndisponibilite[] }
  | { statut: "indisponible"; raisons: RaisonIndisponibilite[] };

async function resoudreDonneesAnnee(dossierFiscalId: string, an: number): Promise<DonneesAnneeMicroBnc> {
  const assiette = await calculerAssietteAnnuelle(dossierFiscalId, an);
  const plafond = await resoudreRegle(CODE_PLAFOND, CATEGORIE_ACTIVITE, `${an}-12-31`);
  if (assiette.couverture === "complete" && plafond) {
    return { statut: "connue", assiette, depasse: assiette.montantConnuCentimes > plafond.valeur };
  }
  return { statut: "indeterminee", assiette };
}

function raisonsDeAnnee(annee: number, donnees: DonneesAnneeMicroBnc): RaisonIndisponibilite[] {
  return donnees.statut === "indeterminee" && donnees.assiette.couverture === "partielle"
    ? [{ type: "assiette_incomplete", periodesInconnues: donnees.assiette.periodesInconnues }]
    : donnees.statut === "indeterminee"
      ? [{ type: "regle_absente", code: CODE_PLAFOND, date: `${annee}-12-31` }]
      : [];
}

// Recettes connues / plafond légal plein / marge restante / statut des deux années de référence
// (ADR-024, calcul micro-BNC). Ne se prononce JAMAIS sur une "sortie du micro" — ni ici, ni dans le
// statut des années N-1/N-2 : seuls des faits factuels (recettes connues vs plafond plein, par
// année, avec leur propre état de couverture) sont exposés ; le mécanisme légal des deux années
// consécutives et ses conséquences relèvent d'une évolution ultérieure, hors périmètre ADR-024.
export async function calculerMicroBnc(dossierFiscalId: string, annee: number): Promise<ResultatMicroBnc> {
  const dateResolution = `${annee}-12-31`;
  const profil = await chargerProfilFiscalADate(dossierFiscalId, dateResolution);
  if (!profil || profil.regimeFiscal !== "micro_bnc") {
    return {
      statut: "indisponible",
      raisons: [{ type: "regime_non_couvert", regimeFiscal: profil?.regimeFiscal ?? "inconnu", date: dateResolution }],
    };
  }

  const plafond = await resoudreRegle(CODE_PLAFOND, CATEGORIE_ACTIVITE, dateResolution);
  if (!plafond) {
    return { statut: "indisponible", raisons: [{ type: "regle_absente", code: CODE_PLAFOND, date: dateResolution }] };
  }

  const anneeCourante = await resoudreDonneesAnnee(dossierFiscalId, annee);
  const raisons: RaisonIndisponibilite[] = [...raisonsDeAnnee(annee, anneeCourante)];

  const debutAnnee = `${annee}-01-01`;
  const finAnnee = `${annee}-12-31`;
  const anneeCreation = profil.dateDebutActivite >= debutAnnee && profil.dateDebutActivite <= finAnnee;
  let plafondProratiseReferenceCentimes: number | undefined;
  if (anneeCreation) {
    const jours = joursInclusEntre(profil.dateDebutActivite, finAnnee);
    plafondProratiseReferenceCentimes = prorataJours(plafond.valeur, jours, joursDansAnnee(annee));
  }

  let anneeMoins1: DonneesAnneeMicroBnc | undefined;
  if (profil.dateDebutActivite <= `${annee - 1}-12-31`) {
    anneeMoins1 = await resoudreDonneesAnnee(dossierFiscalId, annee - 1);
    raisons.push(...raisonsDeAnnee(annee - 1, anneeMoins1));
  }
  let anneeMoins2: DonneesAnneeMicroBnc | undefined;
  if (profil.dateDebutActivite <= `${annee - 2}-12-31`) {
    anneeMoins2 = await resoudreDonneesAnnee(dossierFiscalId, annee - 2);
    raisons.push(...raisonsDeAnnee(annee - 2, anneeMoins2));
  }

  const valeur: ValeurMicroBnc = {
    plafondPleinCentimes: plafond.valeur,
    provenancePlafond: provenanceDe(plafond),
    anneeCourante,
    anneeCreation,
    plafondProratiseReferenceCentimes,
    anneeMoins1,
    anneeMoins2,
  };

  if (raisons.length === 0) return { statut: "calcule", valeur };
  return { statut: "partiel", valeurConnue: valeur, raisons };
}
