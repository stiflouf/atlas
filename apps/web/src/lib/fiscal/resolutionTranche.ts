import { chargerProfilFiscalADate } from "@/lib/profilFiscalRepository";
import { resoudreRegle } from "@/lib/referentielFiscalRepository";
import { appliquerTauxPointsBase } from "@/lib/fiscal/arithmetiqueFiscale";
import type { TrancheAssiette } from "@/lib/fiscal/assietteAnnuelle";
import type { ProfilFiscal } from "@/types/profilFiscal";
import type { AssietteAnnuelle } from "@/types/assietteFiscale";
import type { ProvenanceRegle, RaisonIndisponibilite, ResultatFiscal } from "@/types/resultatFiscal";
import type { RegleFiscale } from "@/types/regleFiscale";

export type IssueTranche =
  | { ok: true; montantCentimes: number; provenance: ProvenanceRegle }
  | { ok: false; raison: RaisonIndisponibilite };

// Détermine, à partir du profil applicable à une date, quel code regle_fiscale s'applique — ou
// `undefined` si ce profil n'est pas couvert par les règles micro de cette V1 (ADR-024, correction
// n° 2). Permet de brancher sur plusieurs champs du profil (regimeFiscal, affiliationRetraite...),
// pas seulement une comparaison fixe : ex. cotisationsSociales choisit le code selon l'affiliation,
// et retourne undefined pour la Cipav (aucun code correspondant n'existe encore dans le référentiel
// — resoudreRegle échouera alors naturellement plutôt que d'appliquer le taux du régime général).
export type ResoudreCode = (profil: ProfilFiscal) => string | undefined;

export function provenanceDe(regle: RegleFiscale): ProvenanceRegle {
  return {
    code: regle.code,
    categorieActivite: regle.categorieActivite,
    dateDebutValidite: regle.dateDebutValidite,
    dateFinValidite: regle.dateFinValidite,
    statutVerification: regle.statutVerification,
    sourceLibelle: regle.sourceLibelle,
    sourceUrl: regle.sourceUrl,
  };
}

// Rattache une tranche datée de l'assiette au taux légal applicable à SA date (ADR-024) — jamais un
// taux moyen ni le dernier taux connu appliqué à tout le montant.
export async function resoudreTrancheAvecTaux(
  dossierFiscalId: string,
  annee: number,
  tranche: TrancheAssiette,
  categorieActivite: string,
  resoudreCode: ResoudreCode
): Promise<IssueTranche> {
  if (tranche.origine === "remuneration_atlas") {
    const profil = await chargerProfilFiscalADate(dossierFiscalId, tranche.date);
    const code = profil ? resoudreCode(profil) : undefined;
    if (!profil || !code) {
      return {
        ok: false,
        raison: { type: "regime_non_couvert", regimeFiscal: profil?.regimeFiscal ?? "inconnu", date: tranche.date },
      };
    }
    const regle = await resoudreRegle(code, categorieActivite, tranche.date);
    if (!regle) return { ok: false, raison: { type: "regle_absente", code, date: tranche.date } };
    return {
      ok: true,
      montantCentimes: appliquerTauxPointsBase(tranche.montantCentimes, regle.valeur),
      provenance: provenanceDe(regle),
    };
  }

  // Tranche historique_amorcage : un intervalle, pas une date unique — le code applicable ET la
  // règle doivent être stables aux deux bornes pour que le montant global soit ventilable sans
  // deviner de répartition infra-période (ADR-024, traitement des changements de taux).
  const [profilDebut, profilFin] = await Promise.all([
    chargerProfilFiscalADate(dossierFiscalId, tranche.dateDebut),
    chargerProfilFiscalADate(dossierFiscalId, tranche.dateFin),
  ]);
  const codeDebut = profilDebut ? resoudreCode(profilDebut) : undefined;
  const codeFin = profilFin ? resoudreCode(profilFin) : undefined;
  if (!codeDebut || !codeFin) {
    return {
      ok: false,
      raison: {
        type: "regime_non_couvert",
        regimeFiscal: profilFin?.regimeFiscal ?? profilDebut?.regimeFiscal ?? "inconnu",
        date: tranche.dateFin,
      },
    };
  }
  if (codeDebut !== codeFin) {
    return { ok: false, raison: { type: "amorcage_non_ventilable", annee, codeRegle: codeDebut } };
  }
  const [regleDebut, regleFin] = await Promise.all([
    resoudreRegle(codeDebut, categorieActivite, tranche.dateDebut),
    resoudreRegle(codeDebut, categorieActivite, tranche.dateFin),
  ]);
  if (!regleDebut || !regleFin) {
    return {
      ok: false,
      raison: { type: "regle_absente", code: codeDebut, date: !regleDebut ? tranche.dateDebut : tranche.dateFin },
    };
  }
  if (regleDebut.id !== regleFin.id) {
    return { ok: false, raison: { type: "amorcage_non_ventilable", annee, codeRegle: codeDebut } };
  }
  return {
    ok: true,
    montantCentimes: appliquerTauxPointsBase(tranche.montantCentimes, regleDebut.valeur),
    provenance: provenanceDe(regleDebut),
  };
}

// Agrège une liste d'issues de tranches en un ResultatFiscal<number> (ADR-024, point 6). Règle de
// statut : "calcule" seulement si AUCUNE raison n'existe, y compris l'incomplétude de l'assiette
// elle-même (jamais "calcule" sur une couverture partielle, même si toutes les tranches connues ont
// résolu un taux) ; "indisponible" seulement si des tranches existaient et qu'AUCUNE n'a pu être
// résolue (le moteur ne peut rien affirmer) ; "partiel" dans tous les autres cas mêlant du connu et
// de l'inconnu.
export function construireResultatFiscal(assiette: AssietteAnnuelle, issues: IssueTranche[]): ResultatFiscal<number> {
  const raisons: RaisonIndisponibilite[] = [];
  const provenanceParCle = new Map<string, ProvenanceRegle>();
  let valeur = 0;

  for (const issue of issues) {
    if (issue.ok) {
      valeur += issue.montantCentimes;
      provenanceParCle.set(`${issue.provenance.code}:${issue.provenance.dateDebutValidite}`, issue.provenance);
    } else {
      raisons.push(issue.raison);
    }
  }
  if (assiette.couverture === "partielle") {
    raisons.push({ type: "assiette_incomplete", periodesInconnues: assiette.periodesInconnues });
  }

  const provenance = [...provenanceParCle.values()];
  if (raisons.length === 0) {
    return { statut: "calcule", valeur, provenance, assiette };
  }
  const toutEchoue = issues.length > 0 && issues.every((i) => !i.ok);
  if (toutEchoue) {
    return { statut: "indisponible", raisons };
  }
  return { statut: "partiel", valeurConnue: valeur, provenance, raisons, assiette };
}
