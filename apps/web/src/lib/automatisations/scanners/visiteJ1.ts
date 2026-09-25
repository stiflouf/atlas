import { getDb } from "@/db/client";
import { visitesPlanifieesPourDate } from "@/lib/visiteRepository";
import { cloturerTachesAutomatiquesObsoletes } from "@/lib/tacheRepository";
import { ajouterJoursCivils } from "@/lib/temps";
import { getConfigurationAutomatisation } from "../configurationAutomatisationRepository";
import { emettreEvenementEtPreparerExecutions } from "../evenementMetierRepository";
import { traiterExecutionsEnAttente } from "../moteur";
import { demarrerRunScanAutomatisation, terminerRunScanAutomatisation } from "../runScanAutomatisationRepository";
import type { ResultatScanRegle } from "../scanTemporel";

const REGLE_CODE = "visite_j_1" as const;

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// VISIT_AUTOMATION_V1 (ADR-063) — règle 5 : une Visite canonique encore `planifiee` dont
// `datePrevue` tombe dans `seuilJours` jours (1 = J-1 par défaut). `visitesPlanifieesPourDate`
// (visiteRepository.ts) fait le travail set-based : une requête, jamais une par Visite.
//
// Idempotence CYCLIQUE (brief §31, même mécanisme qu'`inactivite_prospect_vendeur`, ADR-033) :
// l'occurrence est identifiée par (visiteId, datePrevue au moment du franchissement), via l'index
// partiel dédié `evenements_metier_visite_j1_unique`. Un report change `datePrevue`, donc l'ancre,
// et ouvre donc légitimement une NOUVELLE occurrence possible ; la même date rejouée (scans
// concurrents, ou la visite redevient candidate sans report) ne duplique jamais. Une fermeture
// humaine de la tâche pour CETTE date ne la ressuscite jamais (politique A, garantie structurelle
// par le filtre `annulee_le/terminee_le IS NULL` de `cloturerTachesAutomatiquesObsoletes`).
//
// Obsolescence : ferme toute tâche automatique de cette règle dont la Visite n'est plus candidate à
// CE scan — couvre annulation, réalisation (CR créé) et report hors de la fenêtre J-1 (brief §3),
// sans distinguer la cause. Colonne cible = `visiteCanoniqueId` = identité d'occurrence ici (jamais
// de dérivation comme pour `mandat_expire_bientot`) : `cloturerTachesAutomatiquesObsoletes`
// générique suffit.
export async function scannerVisiteJ1(workspaceId: string, maintenant: Date = new Date()): Promise<ResultatScanRegle> {
  const configuration = await getConfigurationAutomatisation(REGLE_CODE, workspaceId);
  if (!configuration.active || configuration.seuilJours == null) {
    return { codeRegle: REGLE_CODE, workspaceId, execute: false };
  }

  const runId = await demarrerRunScanAutomatisation(REGLE_CODE, workspaceId);
  let nombreCandidats = 0;
  let nombreOccurrencesCreees = 0;
  let nombreTachesObsoletes = 0;

  try {
    const dateCibleISO = ajouterJoursCivils(maintenant, configuration.seuilJours);
    const candidats = await visitesPlanifieesPourDate(workspaceId, dateCibleISO);
    nombreCandidats = candidats.length;

    for (const visite of candidats) {
      try {
        // Ancre déterministe dérivée de `datePrevue` (jamais une heure — ADR-040/041) : sert
        // uniquement de clé d'unicité, jamais affichée.
        const ancreCycle = new Date(`${visite.datePrevue}T00:00:00.000Z`);
        const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
          emettreEvenementEtPreparerExecutions({ typeEvenement: REGLE_CODE, visiteId: visite.id, ancreCycle }, workspaceId, tx)
        );
        if (evenement) nombreOccurrencesCreees += 1;
        await traiterExecutionsEnAttente(idsExecutionsATraiter);
      } catch (erreur) {
        // Isolée par Visite, même principe que les autres scanners : une erreur n'affecte jamais
        // les autres candidats ; le prochain run la retrouvera (aucune ligne d'événement créée).
        console.error("[automatisations] échec du traitement d'une occurrence visite_j_1 :", erreur);
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
