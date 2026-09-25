import { scannerInactiviteProspectVendeur } from "./scanners/inactiviteProspectVendeur";
import { scannerMandatExpireBientot } from "./scanners/mandatExpireBientot";
import { scannerOffreSansDecision } from "./scanners/offreSansDecision";
import { scannerOffreAccepteeSansCompromis } from "./scanners/offreAccepteeSansCompromis";
import { scannerVisiteJ1 } from "./scanners/visiteJ1";
import { scannerVisiteSansCompteRendu } from "./scanners/visiteSansCompteRendu";
import { listerTousLesWorkspaceIds } from "@/lib/workspaceRepository";
import type { CodeRegleAutomatisation } from "@/types/automatisation";

// AUTOMATION_ENGINE_GENERALIZATION_V1 — moteur temporel GÉNÉRIQUE (ADR-033 généralisé). Remplace
// l'ancien couplage direct route -> `scannerInactiviteProspectVendeur()` par un vrai registre :
// chaque règle temporelle est un `ScannerTemporel` explicite, déclaré une fois ici, jamais un cas
// spécial dans la route (brief §3/§29/§50). Volontairement AUCUNE abstraction "squelette" générique
// au-delà du registre lui-même (brief §33, pas de DSL) : chaque scanner (src/lib/automatisations/
// scanners/*.ts) reste du code TypeScript explicite suivant le même déroulé —
// configuration -> workspace -> run -> candidats -> par occurrence -> obsolescence -> fin de run —
// déjà éprouvé par `scannerInactiviteProspectVendeur` avant ce lot.
// WORKSPACE_SCOPING_V2B5 — un résultat porte désormais SON workspace. Ce n'est pas un détail de
// journal : une règle peut être active dans A et inactive dans B, réussir dans A et échouer dans B.
// Agréger les deux en une seule ligne de résultat aurait effacé exactement ce que ce lot rend
// possible.
export type ResultatScanRegle =
  | { codeRegle: CodeRegleAutomatisation; workspaceId: string; execute: false }
  | {
      codeRegle: CodeRegleAutomatisation;
      workspaceId: string;
      execute: true;
      runId: string;
      nombreCandidats: number;
      nombreOccurrencesCreees: number;
      nombreTachesObsoletes?: number;
      erreurTechnique?: string;
    };

// `workspaceId` est le PREMIER paramètre, et il est obligatoire : un scanner ne résout plus le
// périmètre lui-même (c'était `resoudreWorkspaceExecutionMachine()`, qui supposait qu'il n'en
// existait qu'un et échouait dès le second). Il le reçoit de la boucle ci-dessous.
export type ScannerTemporel = {
  codeRegle: CodeRegleAutomatisation;
  executer: (workspaceId: string, maintenant?: Date) => Promise<ResultatScanRegle>;
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
//
// WORKSPACE_SCOPING_V2B5 — double boucle WORKSPACE × RÈGLE. Le runner reste MACHINE et GLOBAL (sa
// garde est le secret Bearer de sa route, jamais une session : aucun `exigerWorkspaceCourant()` ne
// doit apparaître sur ce chemin) ; ce qui change, c'est qu'il ne traite plus « le » workspace mais
// tous, chacun avec SA configuration et SES candidats. L'isolation joue aussi entre workspaces :
// une base indisponible pendant le passage de A n'empêche pas celui de B.
//
// Workspaces à l'extérieur, règles à l'intérieur : l'ordre des résultats regroupe ainsi tout ce qui
// concerne un même workspace, ce qui rend le journal lisible quand il y en aura plusieurs dizaines.
export async function executerScanTemporelComplet(maintenant: Date = new Date()): Promise<ResultatScanRegle[]> {
  const resultats: ResultatScanRegle[] = [];
  for (const workspaceId of await listerTousLesWorkspaceIds()) {
    for (const scanner of SCANNERS_TEMPORELS) {
      try {
        resultats.push(await scanner.executer(workspaceId, maintenant));
      } catch (erreur) {
        resultats.push({
          codeRegle: scanner.codeRegle,
          workspaceId,
          execute: true,
          runId: "",
          nombreCandidats: 0,
          nombreOccurrencesCreees: 0,
          erreurTechnique: categoriserErreur(erreur),
        });
      }
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
