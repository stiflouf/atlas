import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { resoudreRegle } from "@/lib/referentielFiscalRepository";
import { calculerAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import { provenanceDe } from "@/lib/fiscal/resolutionTranche";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";
import type { ProvenanceRegle, RaisonIndisponibilite } from "@/types/resultatFiscal";

const CATEGORIE_ACTIVITE = "agent_commercial_immobilier";
const CODE_SEUIL_BASE = "seuil_tva_base";
const CODE_SEUIL_MAJORE = "seuil_tva_majore";

export type ValeurFranchiseTva = {
  caReferenceConnuCentimes: number;
  seuilBaseCentimes: number;
  seuilMajoreCentimes: number;
  margeAvantSeuilBaseCentimes: number; // peut être négative : seuil déjà dépassé sur la base connue
  margeAvantSeuilMajoreCentimes: number;
  provenanceSeuilBase: ProvenanceRegle;
  provenanceSeuilMajore: ProvenanceRegle;
};

export type ResultatFranchiseTva =
  | { statut: "calcule"; valeur: ValeurFranchiseTva; assiette: AssietteAnnuelle }
  | { statut: "partiel"; valeurConnue: ValeurFranchiseTva; raisons: RaisonIndisponibilite[]; assiette: AssietteAnnuelle }
  | { statut: "indisponible"; raisons: RaisonIndisponibilite[] };

// ADR-024, correction obligatoire n° 3 : ADR-024 ne calcule aucune fiscalité TVA pour un profil
// redevable — montantRemunerationConseillerCentimes n'a aujourd'hui aucune sémantique HT/TTC
// modélisée, Atlas ne peut donc pas en tirer un CA de référence correct pour un régime qui facture
// la TVA. Le moteur V1 ne traite QUE regimeTva === 'franchise' (surveillance du seuil de sortie) ;
// 'redevable_reel_simplifie'/'redevable_reel_normal'/'inconnu' retournent un résultat indisponible
// explicite plutôt qu'un chiffre construit sur une hypothèse HT/TTC non vérifiée. Aucune couche
// TVA/facturation n'est créée ici — hors périmètre ADR-024.
export async function calculerFranchiseTva(dossierFiscalId: string, annee: number): Promise<ResultatFranchiseTva> {
  const dateResolution = `${annee}-12-31`;
  const profil = await chargerProfilFiscalADate(dossierFiscalId, dateResolution);
  if (!profil || profil.regimeTva !== "franchise") {
    return {
      statut: "indisponible",
      raisons: [{ type: "regime_tva_non_supporte", regimeTva: profil?.regimeTva ?? "inconnu" }],
    };
  }

  const [seuilBase, seuilMajore] = await Promise.all([
    resoudreRegle(CODE_SEUIL_BASE, CATEGORIE_ACTIVITE, dateResolution),
    resoudreRegle(CODE_SEUIL_MAJORE, CATEGORIE_ACTIVITE, dateResolution),
  ]);
  const raisons: RaisonIndisponibilite[] = [];
  if (!seuilBase) raisons.push({ type: "regle_absente", code: CODE_SEUIL_BASE, date: dateResolution });
  if (!seuilMajore) raisons.push({ type: "regle_absente", code: CODE_SEUIL_MAJORE, date: dateResolution });
  if (!seuilBase || !seuilMajore) return { statut: "indisponible", raisons };

  const assiette = await calculerAssietteAnnuelle(dossierFiscalId, annee);
  if (assiette.couverture === "partielle") {
    raisons.push({ type: "assiette_incomplete", periodesInconnues: assiette.periodesInconnues });
  }

  const valeur: ValeurFranchiseTva = {
    caReferenceConnuCentimes: assiette.montantConnuCentimes,
    seuilBaseCentimes: seuilBase.valeur,
    seuilMajoreCentimes: seuilMajore.valeur,
    margeAvantSeuilBaseCentimes: seuilBase.valeur - assiette.montantConnuCentimes,
    margeAvantSeuilMajoreCentimes: seuilMajore.valeur - assiette.montantConnuCentimes,
    provenanceSeuilBase: provenanceDe(seuilBase),
    provenanceSeuilMajore: provenanceDe(seuilMajore),
  };

  if (raisons.length === 0) return { statut: "calcule", valeur, assiette };
  return { statut: "partiel", valeurConnue: valeur, raisons, assiette };
}
