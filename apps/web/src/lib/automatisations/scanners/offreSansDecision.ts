import { getDb } from "@/db/client";
import { offresEnCoursDepasseesSeuil } from "@/lib/offreRepository";
import { cloturerTachesAutomatiquesObsoletes } from "@/lib/tacheRepository";
import { ajouterJoursCivils } from "@/lib/temps";
import { getConfigurationAutomatisation } from "../configurationAutomatisationRepository";
import { emettreEvenementEtPreparerExecutions } from "../evenementMetierRepository";
import { traiterExecutionsEnAttente } from "../moteur";
import { demarrerRunScanAutomatisation, terminerRunScanAutomatisation } from "../runScanAutomatisationRepository";
import type { ResultatScanRegle } from "../scanTemporel";

const REGLE_CODE = "offre_sans_decision" as const;

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// AUTOMATION_ENGINE_GENERALIZATION_V1 — règle 2 : une offre encore `en_cours` dont `dateOffre`
// dépasse le seuil configuré (`offresEnCoursDepasseesSeuil`, offreRepository.ts, set-based).
// Stratégie TEMPORELLE UNIQUEMENT (ADR-062) : aucune règle événementielle sur `offre_recue` n'a été
// ajoutée en parallèle — ce scan est l'unique déclencheur, jamais deux mécanismes pouvant produire
// deux tâches pour la même offre.
//
// Idempotence : occurrence identifiée par `offreId` (ponctuel — une offre ne "redevient" jamais
// en_cours après une décision), via l'index partiel générique `evenements_metier_offre_unique`
// (déjà existant pour les types `offre_*` d'ADR-061, réutilisé tel quel).
//
// Obsolescence : une offre dont le seuil d'âge reste franchi ne ressort JAMAIS du jeu de candidats
// tant qu'elle reste `en_cours` (le seuil est une date fixe, jamais franchi "à nouveau" en arrière) —
// la SEULE façon de sortir du jeu de candidats d'un scan au suivant est un changement de statut
// (acceptee/refusee/retiree/caduque). `cloturerTachesAutomatiquesObsoletes` "NOT IN candidats"
// couvre donc exactement et uniquement brief §14, sans requête de fermeture séparée.
export async function scannerOffreSansDecision(workspaceId: string, maintenant: Date = new Date()): Promise<ResultatScanRegle> {
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
    const candidats = await offresEnCoursDepasseesSeuil(workspaceId, seuilDateISO);
    nombreCandidats = candidats.length;

    for (const offre of candidats) {
      try {
        const { evenement, idsExecutionsATraiter } = await getDb().transaction((tx) =>
          emettreEvenementEtPreparerExecutions({ typeEvenement: REGLE_CODE, offreId: offre.id }, workspaceId, tx)
        );
        if (evenement) nombreOccurrencesCreees += 1;
        await traiterExecutionsEnAttente(idsExecutionsATraiter);
      } catch (erreur) {
        console.error("[automatisations] échec du traitement d'une occurrence d'offre sans décision :", erreur);
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
