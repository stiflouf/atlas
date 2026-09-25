import { getDb } from "@/db/client";
import { offresAccepteesSansCompromis } from "@/lib/offreRepository";
import { cloturerTachesAutomatiquesObsoletes } from "@/lib/tacheRepository";
import { ajouterJoursCivils } from "@/lib/temps";
import { getConfigurationAutomatisation } from "../configurationAutomatisationRepository";
import { emettreEvenementEtPreparerExecutions } from "../evenementMetierRepository";
import { traiterExecutionsEnAttente } from "../moteur";
import { demarrerRunScanAutomatisation, terminerRunScanAutomatisation } from "../runScanAutomatisationRepository";
import type { ResultatScanRegle } from "../scanTemporel";

const REGLE_CODE = "offre_acceptee_sans_compromis" as const;

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — règle 3 : une offre `acceptee` depuis au moins le seuil
// configuré, sans AUCUN compromis lié (`offresAccepteesSansCompromis`, offreRepository.ts,
// anti-jointure `notExists` set-based). Valorise directement le lifecycle Offre d'ADR-061.
//
// Idempotence : occurrence identifiée par `offreId`, même index partiel générique que
// `offre_sans_decision` (une offre n'est acceptée qu'une seule fois dans sa vie — cycle
// irréversible, ADR-061).
//
// Obsolescence (brief §16, exactement deux causes) : un compromis créé pour cette offre FAIT
// disparaître la ligne du résultat `notExists` du prochain scan ; une offre devenue `caduque` sort
// du filtre `statut = 'acceptee'`. Dans les deux cas l'offre sort du jeu de candidats du scan en
// cours — `cloturerTachesAutomatiquesObsoletes` "NOT IN candidats" couvre donc les deux causes en
// une seule requête, sans distinguer laquelle s'est produite.
export async function scannerOffreAccepteeSansCompromis(workspaceId: string, maintenant: Date = new Date()): Promise<ResultatScanRegle> {
  const configuration = await getConfigurationAutomatisation(REGLE_CODE, workspaceId);
  if (!configuration.active || configuration.seuilJours == null) {
    return { codeRegle: REGLE_CODE, workspaceId, execute: false };
  }

  const runId = await demarrerRunScanAutomatisation(REGLE_CODE, workspaceId);
  let nombreCandidats = 0;
  let nombreOccurrencesCreees = 0;
  let nombreTachesObsoletes = 0;

  try {
    const seuilDateISO = ajouterJoursCivils(maintenant, -configuration.seuilJours);
    const candidats = await offresAccepteesSansCompromis(workspaceId, seuilDateISO);
    nombreCandidats = candidats.length;

    for (const offre of candidats) {
      try {
        const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
          emettreEvenementEtPreparerExecutions({ typeEvenement: REGLE_CODE, offreId: offre.id }, workspaceId, tx)
        );
        if (evenement) nombreOccurrencesCreees += 1;
        await traiterExecutionsEnAttente(idsExecutionsATraiter);
      } catch (erreur) {
        console.error("[automatisations] échec du traitement d'une occurrence d'offre acceptée sans compromis :", erreur);
      }
    }

    nombreTachesObsoletes = await cloturerTachesAutomatiquesObsoletes(
      REGLE_CODE,
      "offreId",
      candidats.map((o) => o.id),
      workspaceId
    );

    await terminerRunScanAutomatisation(runId, { nombreCandidats, nombreOccurrencesCreees });
    return { codeRegle: REGLE_CODE, workspaceId, execute: true, runId, nombreCandidats, nombreOccurrencesCreees, nombreTachesObsoletes };
  } catch (erreur) {
    const erreurTechnique = categoriserErreur(erreur);
    await terminerRunScanAutomatisation(runId, { nombreCandidats, nombreOccurrencesCreees, erreurTechnique });
    return { codeRegle: REGLE_CODE, workspaceId, execute: true, runId, nombreCandidats, nombreOccurrencesCreees, nombreTachesObsoletes, erreurTechnique };
  }
}
