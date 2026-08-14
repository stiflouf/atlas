import { getDb } from "@/db/client";
import { creerTache } from "@/lib/tacheRepository";
import { getEvenementMetierById } from "./evenementMetierRepository";
import { marquerExecutionEchouee, marquerExecutionReussie, verrouillerExecutionATraiter } from "./executionAutomatisationRepository";
import { trouverRegle } from "./catalogueRegles";
import type { EvenementMetier } from "@/types/automatisation";

function categoriserErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message.slice(0, 200);
  return "erreur_inconnue";
}

// Traite UNE exécution "à traiter" (ADR-032, correction n°6) : verrouille la ligne, construit puis
// crée la tâche, pose tacheId+reussieLe — le tout dans UNE SEULE transaction. Si la construction
// ou la création de la tâche échoue, la transaction est annulée dans son ensemble : AUCUNE tâche
// n'est jamais créée orpheline de son audit. L'échec est ensuite enregistré séparément
// (echoueeLe), hors de cette transaction déjà annulée par Postgres — jamais à l'intérieur.
//
// Jamais appelée en dehors d'une transaction métier déjà validée (l'événement et l'exécution
// "à traiter" existent déjà, posés atomiquement avec la mutation d'origine, ADR-032 correction
// n°2) — l'échec de cette fonction ne remonte donc jamais à la Server Action qui a déclenché
// l'événement.
async function traiterUneExecution(executionId: string): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      const execution = await verrouillerExecutionATraiter(executionId, tx);
      if (!execution) return; // déjà résolue (reussie/echouee) — rien à retraiter

      const regle = trouverRegle(execution.regleCode);
      if (!regle) throw new Error(`Règle inconnue du catalogue : ${execution.regleCode}`);

      const evenement = await getEvenementMetierById(execution.evenementId);
      if (!evenement) throw new Error("Événement introuvable pour cette exécution.");

      const champs = await regle.construireTache(evenement);
      if (!champs) {
        // La règle décide de ne rien produire pour ce cas précis — un résultat honnête, pas un
        // échec : l'exécution est tout de même résolue "reussie" (aucune tâche à rattacher).
        await marquerExecutionReussie(executionId, undefined, tx);
        return;
      }

      const tache = await creerTache(
        {
          titre: champs.titre,
          contexte: champs.contexte,
          type: champs.type,
          priorite: champs.priorite,
          origine: "automatique",
          origineCode: regle.code,
          cible: champs.cible,
        },
        tx
      );
      await marquerExecutionReussie(executionId, tache.id, tx);
    });
  } catch (erreur) {
    console.error("[automatisations] échec du traitement d'une exécution :", erreur);
    await marquerExecutionEchouee(executionId, categoriserErreur(erreur));
  }
}

// Point d'entrée appelé par les Server Actions déclenchantes, TOUJOURS après le COMMIT de la
// transaction métier (jamais à l'intérieur) — le traitement reste synchrone dans la même requête
// (aucun worker, aucun scheduler, ADR-032) mais son échec ne peut jamais faire échouer ou annuler
// la mutation métier déjà validée.
export async function traiterExecutionsEnAttente(idsExecutions: string[]): Promise<void> {
  for (const id of idsExecutions) {
    await traiterUneExecution(id);
  }
}
