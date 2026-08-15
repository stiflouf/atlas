import {
  incrementerTentativeExecution,
  listerExecutionsATraiter,
  marquerExecutionEchouee,
} from "./executionAutomatisationRepository";
import { traiterExecutionsEnAttente } from "./moteur";

// Filet de reprise générique des exécutions restées `a_traiter` après une interruption du process
// (ADR-038) — jamais le chemin nominal (le traitement immédiat après chaque mutation métier reste
// inchangé, ADR-032). N'existe QUE parce que la transaction effet+reussieLe de `traiterUneExecution`
// (moteur.ts) garantit déjà qu'une ligne `a_traiter` n'a JAMAIS pu produire d'effet partiel : la
// reprendre inconditionnellement est donc sûre par construction, sans lease ni statut `en_cours`.
//
// Constante de code, pas un réglage produit — même statut que SEUIL_FIABLE (ADR-035) : un plafond
// de tentatives de reprise n'a pas vocation à être ajusté par le conseiller.
export const MAX_TENTATIVES_AUTOMATISATION = 5;

export type ResultatReprise = {
  examinees: number;
  traitees: number;
  plafondAtteint: number;
};

// Traite UNE candidate : incrémente durablement la tentative (transaction séparée, avant tout
// risque) puis, sauf plafond atteint, réutilise TEL QUEL le noyau canonique de traitement
// (`traiterExecutionsEnAttente`, moteur.ts) — jamais une seconde implémentation des règles
// métier. Isolée : une erreur sur une candidate n'empêche jamais l'examen des suivantes (même
// philosophie que scanTemporel.ts/le balayage ADR-036).
async function traiterUneCandidate(id: string): Promise<"traitee" | "plafond" | "ignoree"> {
  const tentative = await incrementerTentativeExecution(id);
  if (!tentative) return "ignoree"; // déjà résolue entre-temps (chemin synchrone ou reprise concurrente)

  if (tentative.nombreTentatives > MAX_TENTATIVES_AUTOMATISATION) {
    // Devient terminale via la sémantique d'échec DÉJÀ existante (echoueeLe) — jamais un nouveau
    // statut : une boucle de crash répétée sur la même exécution est une anomalie technique réelle,
    // observable et non silencieuse, jamais un retry éternel.
    await marquerExecutionEchouee(id, "Nombre maximal de tentatives de reprise atteint");
    return "plafond";
  }

  await traiterExecutionsEnAttente([id]);
  return "traitee";
}

// Point d'entrée du filet de reprise (/api/automatisations/reprise) — ne rescanne jamais
// `evenements_metier`, ne recalcule jamais l'éligibilité d'une règle : travaille exclusivement sur
// des `executions_automatisation` déjà créées et légitimes (activation figée ADR-032 respectée par
// construction, aucun code de ce fichier ne touche `configurations_automatisation`).
export async function reprendreExecutionsBloquees(limite = 200): Promise<ResultatReprise> {
  const candidates = await listerExecutionsATraiter(limite);
  let traitees = 0;
  let plafondAtteint = 0;

  for (const candidate of candidates) {
    try {
      const resultat = await traiterUneCandidate(candidate.id);
      if (resultat === "traitee") traitees += 1;
      else if (resultat === "plafond") plafondAtteint += 1;
    } catch (erreur) {
      console.error(`[automatisations] échec de la reprise pour l'exécution ${candidate.id} :`, erreur);
    }
  }

  return { examinees: candidates.length, traitees, plafondAtteint };
}
