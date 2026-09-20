import { scannerInactiviteProspectVendeur } from "./scanners/inactiviteProspectVendeur";
import { scannerMandatExpireBientot } from "./scanners/mandatExpireBientot";
import { scannerOffreSansDecision } from "./scanners/offreSansDecision";
import { scannerOffreAccepteeSansCompromis } from "./scanners/offreAccepteeSansCompromis";
import { scannerVisiteJ1 } from "./scanners/visiteJ1";
import { scannerVisiteSansCompteRendu } from "./scanners/visiteSansCompteRendu";
import type { CodeRegleAutomatisation } from "@/types/automatisation";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — moteur temporel GÉNÉRIQUE (ADR-033 généralisé). Remplace
// l'ancien couplage direct route -> `scannerInactiviteProspectVendeur()` par un vrai registre :
// chaque règle temporelle est un `ScannerTemporel` explicite, déclaré une fois ici, jamais un cas
// spécial dans la route (brief §3/§29/§50). Volontairement AUCUNE abstraction "squelette" générique
// au-delà du registre lui-même (brief §33, pas de DSL) : chaque scanner (src/lib/automatisations/
// scanners/*.ts) reste du code TypeScript explicite suivant le même déroulé —
// configuration -> workspace -> run -> candidats -> par occurrence -> obsolescence -> fin de run —
// déjà éprouvé par `scannerInactiviteProspectVendeur` avant ce lot.
export type ResultatScanRegle =
  | { codeRegle: CodeRegleAutomatisation; execute: false }
  | {
      codeRegle: CodeRegleAutomatisation;
      execute: true;
      runId: string;
      nombreCandidats: number;
      nombreOccurrencesCreees: number;
      nombreTachesObsoletes?: number;
      erreurTechnique?: string;
    };

export type ScannerTemporel = {
  codeRegle: CodeRegleAutomatisation;
  executer: (maintenant?: Date) => Promise<ResultatScanRegle>;
};

// Un scanner par règle temporelle — même ordre que leur apparition dans le catalogue événementiel
// n'a aucune importance ici (chacun est indépendant), mais chaque `codeRegle` DOIT correspondre à
// une entrée réelle de `CATALOGUE_REGLES_AUTOMATISATION` (garde structurelle,
// scanTemporel.registry.test.ts).
export const SCANNERS_TEMPORELS: ScannerTemporel[] = [
  { codeRegle: "inactivite_prospect_vendeur", executer: scannerInactiviteProspectVendeur },
  { codeRegle: "mandat_expire_bientot", executer: scannerMandatExpireBientot },
  { codeRegle: "offre_sans_decision", executer: scannerOffreSansDecision },
  { codeRegle: "offre_acceptee_sans_compromis", executer: scannerOffreAccepteeSansCompromis },
  { codeRegle: "visite_j_1", executer: scannerVisiteJ1 },
  { codeRegle: "visite_sans_compte_rendu", executer: scannerVisiteSansCompteRendu },
];

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// Point d'entrée unique appelé par /api/automatisations/scan — parcourt le REGISTRE, jamais une
// règle nommée en dur (brief §29/§50). Chaque scanner est isolé (brief §30, même principe que
// l'isolation par occurrence déjà interne à chaque scanner) : l'échec d'un scanner (exception non
// rattrapée, ex. DB indisponible pendant SON run) n'empêche jamais les suivants de s'exécuter —
// jamais une exception masquée pour autant, elle est rapportée dans le résultat de CE scanner.
export async function executerScanTemporelComplet(maintenant: Date = new Date()): Promise<ResultatScanRegle[]> {
  const resultats: ResultatScanRegle[] = [];
  for (const scanner of SCANNERS_TEMPORELS) {
    try {
      resultats.push(await scanner.executer(maintenant));
    } catch (erreur) {
      resultats.push({
        codeRegle: scanner.codeRegle,
        execute: true,
        runId: "",
        nombreCandidats: 0,
        nombreOccurrencesCreees: 0,
        erreurTechnique: categoriserErreur(erreur),
      });
    }
  }
  return resultats;
}

export { scannerInactiviteProspectVendeur } from "./scanners/inactiviteProspectVendeur";
export { scannerMandatExpireBientot } from "./scanners/mandatExpireBientot";
export { scannerOffreSansDecision } from "./scanners/offreSansDecision";
export { scannerOffreAccepteeSansCompromis } from "./scanners/offreAccepteeSansCompromis";
export { scannerVisiteJ1 } from "./scanners/visiteJ1";
export { scannerVisiteSansCompteRendu } from "./scanners/visiteSansCompteRendu";
