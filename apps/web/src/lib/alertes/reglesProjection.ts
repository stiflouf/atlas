import { construireIdAlerte } from "@/lib/alertes/id";
import type { ContexteAlertes } from "@/lib/alertes/contexte";
import type { AlerteCopilote } from "@/types/alerte";
import type { ConsequencesFiscalesProjetees, ProvenanceRegleProjection } from "@/types/projectionFiscale";

type RegleAlerteProjection = {
  id: string;
  evaluer: (contexte: ContexteAlertes) => AlerteCopilote[];
};

function provenancesDeConsequences(consequences: ConsequencesFiscalesProjetees | undefined): ProvenanceRegleProjection[] {
  if (!consequences) return [];
  const provenances: ProvenanceRegleProjection[] = [];
  for (const resultat of [consequences.cotisations, consequences.cfp, consequences.vfl]) {
    if (resultat.statut !== "indisponible") provenances.push(...resultat.provenance);
  }
  if (consequences.microBnc.statut === "connue") provenances.push(consequences.microBnc.provenance);
  if (consequences.franchiseTva.statut === "connue") {
    provenances.push(consequences.franchiseTva.provenanceSeuilBase, consequences.franchiseTva.provenanceSeuilMajore);
  }
  return provenances;
}

type FaitDepassement = "micro_bnc" | "tva_seuil_base";

// Seuils déjà DÉPASSÉS dans le scénario projeté (marge négative) — jamais la proximité d'un seuil
// non encore atteint, explicitement hors périmètre ADR-026 (décision "option 2+3").
function faitsDepassement(consequences: ConsequencesFiscalesProjetees | undefined): FaitDepassement[] {
  if (!consequences) return [];
  const faits: FaitDepassement[] = [];
  if (consequences.microBnc.statut === "connue" && consequences.microBnc.depasse) faits.push("micro_bnc");
  if (consequences.franchiseTva.statut === "connue" && consequences.franchiseTva.margeAvantSeuilBaseCentimes < 0) {
    faits.push("tva_seuil_base");
  }
  return faits;
}

// D1 — un dépassement projeté par année (jamais par code × bloc individuellement, pour éviter une
// explosion symétrique à celle que D3 corrige explicitement) ; pipeline et tendance statistique sont
// mentionnés côte à côte dans le texte mais jamais additionnés (ADR-025, correction n° 1).
const regleDepassementProjete: RegleAlerteProjection = {
  id: "depassement_projete",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { dossierFiscalId, projectionsPluriannuelles } = contexte.fiscal;
    const alertes: AlerteCopilote[] = [];
    for (const projectionAnnee of projectionsPluriannuelles) {
      const faitsPipeline = faitsDepassement(projectionAnnee.pipeline.consequencesFiscales);
      const faitsStatistique = faitsDepassement(projectionAnnee.statistique.consequencesFiscales);
      if (faitsPipeline.length === 0 && faitsStatistique.length === 0) continue;
      const scenarios = [
        faitsPipeline.length > 0 ? "pipeline" : undefined,
        faitsStatistique.length > 0 ? "tendance statistique" : undefined,
      ].filter((s): s is string => s !== undefined);
      alertes.push({
        id: construireIdAlerte("depassement_projete", dossierFiscalId, projectionAnnee.annee),
        type: "depassement_projete",
        categorie: "fiscal_projete",
        niveau: "information",
        titre: `Dépassement projeté en ${projectionAnnee.annee}`,
        explication: `Dans le scénario ${scenarios.join(" et dans le scénario ")} ${projectionAnnee.annee}, les recettes projetées dépassent une valeur de référence fiscale (plafond micro-BNC et/ou seuil de TVA utilisé par la simulation). Il s'agit toujours d'une projection, jamais d'un verdict.`,
        donneesDeclencheuses: { dossierFiscalId, annee: projectionAnnee.annee },
        provenance: [{ source: "regle_composee", regle: "consequencesFiscalesProjetees.microBnc/franchiseTva" }],
      });
    }
    return alertes;
  },
};

// D3 — regroupée globalement sur tout l'horizon N+1→N+5 : jamais une alerte par code × année (le
// plan interdit explicitement "3 règles × 5 années = 15 alertes"). Indépendante de A3/A7 : une
// absence d'historique utilisateur n'explique jamais une absence de règles fiscales futures — donc
// jamais absorbée par la déduplication causale (voir deduplication.ts).
const regleReglesFuturesHypothetiques: RegleAlerteProjection = {
  id: "regles_futures_hypothetiques",
  evaluer: (contexte) => {
    if (!contexte.fiscal) return [];
    const { dossierFiscalId, projectionsPluriannuelles } = contexte.fiscal;
    if (projectionsPluriannuelles.length === 0) return [];
    const toutesProvenances = projectionsPluriannuelles.flatMap((projectionAnnee) => [
      ...provenancesDeConsequences(projectionAnnee.pipeline.consequencesFiscales),
      ...provenancesDeConsequences(projectionAnnee.statistique.consequencesFiscales),
    ]);
    if (!toutesProvenances.some((p) => p.origine === "hypothese_reconduction")) return [];
    const anneeDebut = projectionsPluriannuelles[0].annee;
    const anneeFin = projectionsPluriannuelles[projectionsPluriannuelles.length - 1].annee;
    return [
      {
        id: construireIdAlerte("regles_futures_hypothetiques", dossierFiscalId, undefined, `${anneeDebut}-${anneeFin}`),
        type: "regles_futures_hypothetiques",
        categorie: "fiscal_projete",
        niveau: "information",
        titre: `Règles reconduites à titre d'hypothèse (${anneeDebut}–${anneeFin})`,
        explication: `Certaines projections ${anneeDebut}–${anneeFin} utilisent des règles reconduites à titre d'hypothèse, car les règles officielles correspondantes ne sont pas encore disponibles pour ces années.`,
        donneesDeclencheuses: { dossierFiscalId },
        provenance: [{ source: "regle_composee", regle: "ProvenanceRegleProjection.origine === hypothese_reconduction" }],
      },
    ];
  },
};

const regles: RegleAlerteProjection[] = [regleDepassementProjete, regleReglesFuturesHypothetiques];

export function produireAlertesProjection(contexte: ContexteAlertes): AlerteCopilote[] {
  return regles.flatMap((regle) => regle.evaluer(contexte));
}
