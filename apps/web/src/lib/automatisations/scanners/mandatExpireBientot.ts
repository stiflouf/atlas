import { and, eq, isNull, notInArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { evenementsMetier as evenementsMetierTable, executionsAutomatisation as executionsAutomatisationTable, taches as tachesTable } from "@/db/schema";
import { mandatsCourantsExpirantBientot } from "@/lib/mandatRepository";
import { cloturerTachesParIds } from "@/lib/tacheRepository";
import { ajouterJoursCivils, formatDateISO } from "@/lib/temps";
import { getConfigurationAutomatisation } from "../configurationAutomatisationRepository";
import { emettreEvenementEtPreparerExecutions } from "../evenementMetierRepository";
import { traiterExecutionsEnAttente } from "../moteur";
import { demarrerRunScanAutomatisation, terminerRunScanAutomatisation } from "../runScanAutomatisationRepository";
import { resoudreWorkspaceExecutionMachine } from "@/lib/workspaceRepository";
import type { ResultatScanRegle } from "../scanTemporel";

const REGLE_CODE = "mandat_expire_bientot" as const;

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// La tâche cible le BIEN (brief §11, pas de colonne mandat_id sur `taches`), mais l'IDENTITÉ d'une
// occurrence est le MANDAT (renouvellement = nouvel id) — le bien reste un candidat valide à
// travers un renouvellement, seul le mandat change. `cloturerTachesAutomatiquesObsoletes`
// (tacheRepository.ts, "NOT IN candidats" sur la colonne cible) ne peut donc PAS détecter cette
// obsolescence : elle exigerait un bienId qui sort du jeu de candidats, ce qui n'arrive jamais lors
// d'un simple renouvellement. Jointure explicite tâche -> exécution -> événement pour retrouver le
// mandat D'ORIGINE de chaque tâche ouverte, puis fermeture par identifiants (`cloturerTachesParIds`)
// des seules tâches dont le mandat d'origine n'est plus un candidat. Deux requêtes, jamais une par
// tâche.
async function idsTachesObsoletes(candidatsMandatIds: string[]): Promise<string[]> {
  const lignes = await getDb()
    .select({ id: tachesTable.id })
    .from(tachesTable)
    .innerJoin(executionsAutomatisationTable, eq(executionsAutomatisationTable.tacheId, tachesTable.id))
    .innerJoin(evenementsMetierTable, eq(evenementsMetierTable.id, executionsAutomatisationTable.evenementId))
    .where(
      and(
        eq(tachesTable.origine, "automatique"),
        eq(tachesTable.origineCode, REGLE_CODE),
        isNull(tachesTable.termineeLe),
        isNull(tachesTable.annuleeLe),
        candidatsMandatIds.length > 0 ? notInArray(evenementsMetierTable.mandatId, candidatsMandatIds) : undefined
      )
    );
  return lignes.map((l) => l.id);
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — règle 1 : un mandat canonique courant (non résilié, non
// remplacé) dont `dateFin` tombe dans les `seuilJours` prochains jours. `mandatsCourantsExpirantBientot`
// (mandatRepository.ts) fait tout le travail set-based (§ADR-060 Scalabilité) : une requête, jamais
// une par mandat.
//
// Idempotence : l'occurrence est identifiée par `mandatId` (ponctuel — un renouvellement crée une
// NOUVELLE ligne `mandats`, donc un `mandatId` différent, donc une occurrence légitimement
// nouvelle), via l'index partiel `evenements_metier_mandat_unique`. Un scan répété sur le MÊME
// mandat ne recrée jamais d'événement/exécution/tâche.
//
// Obsolescence : ferme toute tâche automatique de cette règle dont le MANDAT d'origine (retrouvé
// par jointure, voir `idsTachesObsoletes` ci-dessus) n'est plus dans le jeu de candidats de CE scan
// — couvre la résiliation, le remplacement (renouvellement) et un report de `date_fin` hors fenêtre
// (brief §12), sans distinguer la cause (elle n'a pas besoin de l'être : le fait a disparu, point).
export async function scannerMandatExpireBientot(maintenant: Date = new Date()): Promise<ResultatScanRegle> {
  const configuration = await getConfigurationAutomatisation(REGLE_CODE);
  if (!configuration.active || configuration.seuilJours == null) {
    return { codeRegle: REGLE_CODE, execute: false };
  }

  const workspaceId = await resoudreWorkspaceExecutionMachine();
  const runId = await demarrerRunScanAutomatisation(REGLE_CODE, workspaceId);
  let nombreCandidats = 0;
  let nombreOccurrencesCreees = 0;
  let nombreTachesObsoletes = 0;

  try {
    const aujourdhuiISO = formatDateISO(maintenant);
    const finFenetreISO = ajouterJoursCivils(maintenant, configuration.seuilJours);
    const candidats = await mandatsCourantsExpirantBientot(workspaceId, aujourdhuiISO, finFenetreISO);
    nombreCandidats = candidats.length;

    for (const mandat of candidats) {
      try {
        const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
          emettreEvenementEtPreparerExecutions({ typeEvenement: REGLE_CODE, mandatId: mandat.id }, workspaceId, tx)
        );
        if (evenement) nombreOccurrencesCreees += 1;
        await traiterExecutionsEnAttente(idsExecutionsATraiter);
      } catch (erreur) {
        // Isolée par mandat, même principe que le scanner d'inactivité : une erreur sur un mandat
        // n'affecte jamais les autres ; le prochain run le retrouvera (aucune ligne d'événement
        // n'aura été créée pour lui).
        console.error("[automatisations] échec du traitement d'une occurrence de mandat expirant :", erreur);
      }
    }

    nombreTachesObsoletes = await cloturerTachesParIds(await idsTachesObsoletes(candidats.map((m) => m.id)));

    await terminerRunScanAutomatisation(runId, { nombreCandidats, nombreOccurrencesCreees });
    return { codeRegle: REGLE_CODE, execute: true, runId, nombreCandidats, nombreOccurrencesCreees, nombreTachesObsoletes };
  } catch (erreur) {
    const erreurTechnique = categoriserErreur(erreur);
    await terminerRunScanAutomatisation(runId, { nombreCandidats, nombreOccurrencesCreees, erreurTechnique });
    return { codeRegle: REGLE_CODE, execute: true, runId, nombreCandidats, nombreOccurrencesCreees, nombreTachesObsoletes, erreurTechnique };
  }
}
