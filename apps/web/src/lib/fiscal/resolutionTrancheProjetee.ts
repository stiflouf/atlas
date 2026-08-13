import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { appliquerTauxPointsBase } from "@/lib/fiscal/arithmetiqueFiscale";
import { resoudreRegleProjection, provenanceProjectionDe, valeurDe } from "@/lib/fiscal/resolutionRegleProjection";
import type { ResoudreCode } from "@/lib/fiscal/resolutionTranche";
import type { ProvenanceRegleProjection, RaisonIndisponibiliteProjection, ResultatFiscalProjete } from "@/types/projectionFiscale";

// Une tranche projetée est toujours datée individuellement (un élément de pipeline avec sa propre
// dateEncaissementPrevue, ou un mois de la ventilation run-rate) — jamais un total annuel unique
// appliqué au dernier taux connu (ADR-025, correction n° 4).
export type TrancheProjetee = { montantCentimes: number; date: string };

export type IssueTrancheProjetee =
  | { ok: true; montantCentimes: number; provenance: ProvenanceRegleProjection }
  | { ok: false; raison: RaisonIndisponibiliteProjection };

// Même mécanique que resoudreTrancheAvecTaux (ADR-024, resolutionTranche.ts) mais pour une date
// future : résolution de règle via resoudreRegleProjection (officielle/hypothèse/indisponible)
// plutôt que resoudreRegle seul. Réutilise le même ResoudreCode (garde de régime) que les moteurs
// ADR-024 — jamais une seconde implémentation de la garde.
export async function resoudreTrancheProjeteeAvecTaux(
  dossierFiscalId: string,
  tranche: TrancheProjetee,
  categorieActivite: string,
  resoudreCode: ResoudreCode
): Promise<IssueTrancheProjetee> {
  const profil = await chargerProfilFiscalADate(dossierFiscalId, tranche.date);
  const code = profil ? resoudreCode(profil) : undefined;
  if (!profil || !code) {
    return {
      ok: false,
      raison: { type: "regime_non_couvert", regimeFiscal: profil?.regimeFiscal ?? "inconnu", date: tranche.date },
    };
  }
  const regleProjetee = await resoudreRegleProjection(code, categorieActivite, tranche.date);
  const valeur = valeurDe(regleProjetee);
  if (valeur === undefined) {
    return { ok: false, raison: { type: "regle_absente", code, date: tranche.date } };
  }
  return {
    ok: true,
    montantCentimes: appliquerTauxPointsBase(tranche.montantCentimes, valeur),
    provenance: provenanceProjectionDe(regleProjetee),
  };
}

// Même règle de statut que construireResultatFiscal (ADR-024) : "calcule" seulement si aucune
// raison n'existe, "indisponible" seulement si des tranches existaient et qu'aucune n'a résolu,
// "partiel" sinon.
export function construireResultatFiscalProjete(issues: IssueTrancheProjetee[]): ResultatFiscalProjete<number> {
  const raisons: RaisonIndisponibiliteProjection[] = [];
  const provenanceParCle = new Map<string, ProvenanceRegleProjection>();
  let valeur = 0;

  for (const issue of issues) {
    if (issue.ok) {
      valeur += issue.montantCentimes;
      provenanceParCle.set(JSON.stringify(issue.provenance), issue.provenance);
    } else {
      raisons.push(issue.raison);
    }
  }

  const provenance = [...provenanceParCle.values()];
  if (raisons.length === 0) return { statut: "calcule", valeur, provenance };
  const toutEchoue = issues.length > 0 && issues.every((i) => !i.ok);
  if (toutEchoue) return { statut: "indisponible", raisons };
  return { statut: "partiel", valeurConnue: valeur, provenance, raisons };
}
