import { getDb } from "@/db/client";
import { visitesPlanifieesPasseesSeuil } from "@/lib/visiteRepository";
import { cloturerTachesAutomatiquesObsoletes } from "@/lib/tacheRepository";
import { ajouterJoursCivils } from "@/lib/temps";
import { getConfigurationAutomatisation } from "../configurationAutomatisationRepository";
import { emettreEvenementEtPreparerExecutions } from "../evenementMetierRepository";
import { traiterExecutionsEnAttente } from "../moteur";
import { demarrerRunScanAutomatisation, terminerRunScanAutomatisation } from "../runScanAutomatisationRepository";
import type { ResultatScanRegle } from "../scanTemporel";

const REGLE_CODE = "visite_sans_compte_rendu" as const;

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// VISIT_AUTOMATION_V1 (ADR-063) — règle 6 : une Visite canonique encore `planifiee` dont
// `datePrevue` est passée d'au moins `seuilJours` jours (1 par défaut, brief §6) — exactement le
// signal "visite passée mais encore planifiee parce que le CR n'a pas été fait" (`statut =
// 'planifiee'` suffit à garantir l'absence de CR, voir `visitesPlanifieesPasseesSeuil`).
//
// Idempotence PONCTUELLE (brief §32) : l'occurrence est identifiée par `visiteId` seul — une fois
// un CR créé, la Visite transite définitivement vers `realisee` (jamais un retour en arrière,
// ADR-040) : la condition ne redevient jamais vraie, l'index générique partagé
// `evenements_metier_visite_id_unique` suffit (même index que `visite_annulee`).
//
// Obsolescence : ferme toute tâche automatique dont la Visite n'est plus candidate à CE scan —
// couvre la création du CR (Visite → `realisee`, sort du filtre `statut = 'planifiee'`) et
// l'annulation (brief §7), sans distinguer la cause.
export async function scannerVisiteSansCompteRendu(workspaceId: string, maintenant: Date = new Date()): Promise<ResultatScanRegle> {
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
    const candidats = await visitesPlanifieesPasseesSeuil(workspaceId, seuilDateISO);
    nombreCandidats = candidats.length;

    for (const visite of candidats) {
      try {
        const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
          emettreEvenementEtPreparerExecutions({ typeEvenement: REGLE_CODE, visiteId: visite.id }, workspaceId, tx)
        );
        if (evenement) nombreOccurrencesCreees += 1;
        await traiterExecutionsEnAttente(idsExecutionsATraiter);
      } catch (erreur) {
        console.error("[automatisations] échec du traitement d'une occurrence visite_sans_compte_rendu :", erreur);
      }
    }

    nombreTachesObsoletes = await cloturerTachesAutomatiquesObsoletes(
      REGLE_CODE,
      "visiteCanoniqueId",
      candidats.map((v) => v.id),
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
