import { resoudreAssietteAnnuelle } from "@/lib/fiscal/assietteAnnuelle";
import { construireResultatFiscal, resoudreTrancheAvecTaux, type ResoudreCode } from "@/lib/fiscal/resolutionTranche";
import type { ResultatFiscal } from "@/types/resultatFiscal";

// Exporté (ADR-025) pour être réutilisé tel quel par le moteur de projection pluriannuelle.
export const CATEGORIE_ACTIVITE = "agent_commercial_immobilier";

// ADR-024, correction obligatoire n° 2 : la contribution à la formation professionnelle
// micro-entrepreneur (`taux_cfp_liberal_non_reglemente`, seedée à 0,2 % mais marquée `a_confirmer`,
// ADR-023) ne s'applique qu'au régime micro-BNC — un profil en déclaration contrôlée suit un
// mécanisme CFP différent, hors périmètre V1.
export const resoudreCode: ResoudreCode = (profil) =>
  profil.regimeFiscal === "micro_bnc" ? "taux_cfp_liberal_non_reglemente" : undefined;

// Même principe que calculerCotisationsSociales : rattachement tranche par tranche, jamais un taux
// moyen. Le résultat "calcule" peut porter une provenance dont statutVerification === "a_confirmer"
// (c'est le cas de ce code) — à l'UI de le signaler, le moteur ne refuse pas de calculer pour ce
// motif (seule l'absence totale de règle applicable bloque).
export async function calculerCfp(dossierFiscalId: string, annee: number): Promise<ResultatFiscal<number>> {
  const { assiette, tranches } = await resoudreAssietteAnnuelle(dossierFiscalId, annee);
  const issues = await Promise.all(
    tranches.map((tranche) => resoudreTrancheAvecTaux(dossierFiscalId, annee, tranche, CATEGORIE_ACTIVITE, resoudreCode))
  );
  return construireResultatFiscal(assiette, issues);
}
