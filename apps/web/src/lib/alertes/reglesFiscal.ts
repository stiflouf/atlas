import { PRODUCT_NAME } from "@/lib/branding";
import { construireIdAlerte } from "@/lib/alertes/id";
import { vflActif } from "@/lib/fiscal/versementLiberatoire";
import { formatMontantCentimes } from "@/types/remuneration";
import type { ContexteAlertes } from "@/lib/alertes/contexte";
import type { AlerteCopilote } from "@/types/alerte";
import type { DonneesAnneeMicroBnc, ValeurMicroBnc } from "@/lib/fiscal/microBnc";

type RegleAlerteFiscal = {
  id: string;
  evaluer: (contexte: ContexteAlertes) => AlerteCopilote[];
};

// ResultatMicroBnc/ResultatFranchiseTva portent leur valeur sous un nom différent selon le statut
// ("calcule" -> valeur, "partiel" -> valeurConnue) — un seul accès structurel plutôt que de dupliquer
// le if/else dans chaque règle.
function valeurMicroBnc(contexte: NonNullable<ContexteAlertes["fiscal"]>): ValeurMicroBnc | undefined {
  const { microBnc } = contexte;
  if (microBnc.statut === "calcule") return microBnc.valeur;
  if (microBnc.statut === "partiel") return microBnc.valeurConnue;
  return undefined;
}

// DonneesAnneeMicroBnc.statut === "connue" implique déjà assiette.couverture === "complete" (voir
// resoudreDonneesAnnee, microBnc.ts) : condition du plan ("depasse === true && couverture ===
// complete") satisfaite sans la reformuler.
function anneeDepassee(donnees: DonneesAnneeMicroBnc | undefined): boolean {
  return donnees?.statut === "connue" && donnees.depasse;
}

// C1 — dépassement constaté, jamais un verdict de sortie du régime : calculerMicroBnc ne se
// prononce lui-même jamais là-dessus (ADR-024), l'alerte ne le fait pas non plus.
const regleDepassementMicroConstate: RegleAlerteFiscal = {
  id: "depassement_micro_constate",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const valeur = valeurMicroBnc(contexte.fiscal);
    if (!valeur || !anneeDepassee(valeur.anneeCourante)) return [];
    const { dossierFiscalId, annee } = contexte.fiscal;
    const donneesAnnee = valeur.anneeCourante as Extract<DonneesAnneeMicroBnc, { statut: "connue" }>;
    return [
      {
        id: construireIdAlerte("depassement_micro_constate", dossierFiscalId, annee),
        type: "depassement_micro_constate",
        categorie: "fiscal_constate",
        niveau: "attention",
        titre: `Plafond micro-BNC ${annee} dépassé (constaté)`,
        explication: `Le montant connu de vos recettes ${annee} (${formatMontantCentimes(donneesAnnee.assiette.montantConnuCentimes)}) dépasse la valeur de référence applicable (${formatMontantCentimes(valeur.plafondPleinCentimes)}). Ce constat ne préjuge d'aucune sortie automatique du régime micro.`,
        donneesDeclencheuses: { dossierFiscalId, annee },
        provenance: [{ source: "regle_composee", regle: "microBnc.anneeCourante" }],
      },
    ];
  },
};

// C2 — combinaison de deux faits déjà calculés par calculerMicroBnc (anneeCourante + anneeMoins1),
// jamais une seconde implémentation de la règle micro-BNC.
const regleDeuxAnneesDepassement: RegleAlerteFiscal = {
  id: "deux_annees_depassement",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const valeur = valeurMicroBnc(contexte.fiscal);
    if (!valeur) return [];
    if (!anneeDepassee(valeur.anneeCourante) || !anneeDepassee(valeur.anneeMoins1)) return [];
    const { dossierFiscalId, annee } = contexte.fiscal;
    return [
      {
        id: construireIdAlerte("deux_annees_depassement", dossierFiscalId, annee),
        type: "deux_annees_depassement",
        categorie: "fiscal_constate",
        niveau: "attention",
        titre: `Deux années consécutives au-delà du plafond micro-BNC`,
        explication: `${annee - 1} et ${annee} dépassent toutes les deux, sur leur période connue, la valeur de référence applicable au régime micro-BNC. ${PRODUCT_NAME} expose ce constat factuel — il ne détermine pas si cela déclenche juridiquement une sortie du régime.`,
        donneesDeclencheuses: { dossierFiscalId, annee },
        provenance: [{ source: "regle_composee", regle: "microBnc.anneeCourante + microBnc.anneeMoins1" }],
      },
    ];
  },
};

// C4 — le VFL actif reste calculé normalement à partir du profil : seul le CONTRÔLE d'éligibilité
// (RFR du foyer) est indisponible ici. Ne jamais laisser entendre que le calcul du VFL lui-même est
// incertain.
const regleEligibiliteVflNonVerifiable: RegleAlerteFiscal = {
  id: "eligibilite_vfl_non_verifiable",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { profil, eligibiliteRfr, dossierFiscalId, annee } = contexte.fiscal;
    if (!vflActif(profil)) return [];
    if (eligibiliteRfr.statut !== "indisponible") return [];
    const rfrAbsent = eligibiliteRfr.raisons.find((r) => r.type === "rfr_absent");
    if (!rfrAbsent) return [];
    return [
      {
        id: construireIdAlerte("eligibilite_vfl_non_verifiable", dossierFiscalId, annee),
        type: "eligibilite_vfl_non_verifiable",
        categorie: "fiscal_constate",
        niveau: "attention",
        titre: "Éligibilité au versement libératoire non vérifiable",
        explication: `Le versement libératoire actif sur votre profil est bien calculé normalement. Seul le contrôle d'éligibilité au RFR du foyer (${rfrAbsent.anneeRfrAttendue}) ne peut pas être effectué faute de revenu fiscal de référence renseigné.`,
        donneesDeclencheuses: { dossierFiscalId, annee },
        provenance: [{ source: "raison_indisponibilite", raison: rfrAbsent }],
        action: { libelle: "Renseigner mon RFR", href: "/fiscal#rfr" },
      },
    ];
  },
};

const regles: RegleAlerteFiscal[] = [regleDepassementMicroConstate, regleDeuxAnneesDepassement, regleEligibiliteVflNonVerifiable];

export function produireAlertesFiscal(contexte: ContexteAlertes): AlerteCopilote[] {
  return regles.flatMap((regle) => regle.evaluer(contexte));
}
