import type { RegimeFiscal, RegimeTva } from "@/types/profilFiscal";
import type { StatutVerificationRegle } from "@/types/regleFiscale";
import type { AssietteAnnuelle, PeriodeInconnue } from "@/types/assietteFiscale";

// Provenance obligatoire de toute règle utilisée par un calcul — jamais un taux appliqué sans
// pouvoir remonter à son code, sa période de validité et sa source (ADR-023/024).
export type ProvenanceRegle = {
  code: string;
  categorieActivite: string;
  dateDebutValidite: string;
  dateFinValidite?: string;
  statutVerification: StatutVerificationRegle; // toujours propagé, jamais masqué — à l'UI de le signaler
  sourceLibelle: string;
  sourceUrl: string;
};

// Toutes les raisons pour lesquelles un calcul peut rester partiel ou indisponible — jamais une
// approximation silencieuse à la place. `regime_non_couvert` (moteurs sociaux micro) et
// `regime_tva_non_supporte` (franchise TVA) sont les deux gardes obligatoires ADR-024 : un régime
// non pris en charge par les règles micro ne doit jamais recevoir un taux qui ne lui correspond pas.
export type RaisonIndisponibilite =
  | { type: "regle_absente"; code: string; date: string }
  | { type: "profil_inconnu"; champ: string; date: string }
  | { type: "assiette_incomplete"; periodesInconnues: PeriodeInconnue[] }
  | { type: "rfr_absent"; anneeRfrAttendue: number }
  | { type: "amorcage_non_ventilable"; annee: number; codeRegle: string }
  | { type: "regime_non_couvert"; regimeFiscal: RegimeFiscal; date: string }
  | { type: "regime_tva_non_supporte"; regimeTva: RegimeTva };

// Contrat générique de tout résultat fiscal calculé (ADR-024, point 6) : jamais un `number` ou un
// `number | undefined` nu. "calcule" peut porter une provenance dont statutVerification !==
// "verifie_direct" — c'est à l'UI de le signaler ("à confirmer"), jamais au moteur de refuser de
// calculer pour ce motif. Seule l'absence totale d'une règle requise à la date voulue (ou une garde
// de régime) fait basculer en "partiel"/"indisponible".
export type ResultatFiscal<T> =
  | { statut: "calcule"; valeur: T; provenance: ProvenanceRegle[]; assiette: AssietteAnnuelle }
  | {
      statut: "partiel";
      valeurConnue: T;
      provenance: ProvenanceRegle[];
      raisons: RaisonIndisponibilite[];
      assiette: AssietteAnnuelle;
    }
  | { statut: "indisponible"; raisons: RaisonIndisponibilite[] };
