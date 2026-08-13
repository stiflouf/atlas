import { deriverStatutTache, type Tache } from "@/types/tache";
import type { CompteRenduVisite } from "@/types/compteRenduVisite";
import { scoreTache } from "@/lib/tachePriority";

// "Provenance" (bien vs acquéreur) — distinct de Tache.origine (manuelle/automatique, ADR-028) :
// ce champ décrit uniquement de quelle fiche la tâche a été récupérée pour cette fusion, pas
// comment elle a été créée.
export type ProvenanceTache = "bien" | "acquereur";
export type TacheAvecProvenance = Tache & { provenance: ProvenanceTache };
export type EvenementMemoire = { date: string; texte: string };

// Fusionne les tâches ouvertes du bien et de l'acquéreur en une seule liste triée par
// priorité — même moteur que l'accueil et la fiche bien (tachePriority.ts), aucune nouvelle
// règle de priorisation.
export function selectionnerActionsEnCours(
  tachesBien: Tache[],
  tachesAcquereur: Tache[],
  maintenant: Date = new Date(),
  maximum = 5
): TacheAvecProvenance[] {
  const combinees: TacheAvecProvenance[] = [
    ...tachesBien
      .filter((t) => deriverStatutTache(t) === "a_faire")
      .map((t) => ({ ...t, provenance: "bien" as const })),
    ...tachesAcquereur
      .filter((t) => deriverStatutTache(t) === "a_faire")
      .map((t) => ({ ...t, provenance: "acquereur" as const })),
  ];
  return combinees.sort((a, b) => scoreTache(b, maintenant) - scoreTache(a, maintenant)).slice(0, maximum);
}

function estTermineeAvecDate(tache: Tache): tache is Tache & { termineeLe: string } {
  return deriverStatutTache(tache) === "terminee" && tache.termineeLe !== undefined;
}

// Historique récent pour la préparation de visite : uniquement les tâches du bien réellement
// terminées récemment. Jamais "Bien créé" (peu utile juste avant d'entrer dans le bien) et
// jamais les créations de tâche (déjà visibles, pour celles encore ouvertes, dans "Actions en
// cours" juste au-dessus — les inclure ici doublonnerait la même information).
export function selectionnerHistoriqueRecent(tachesBien: Tache[], maximum = 3): EvenementMemoire[] {
  return tachesBien
    .filter(estTermineeAvecDate)
    .sort((a, b) => (a.termineeLe < b.termineeLe ? 1 : -1))
    .slice(0, maximum)
    .map((t) => ({ date: t.termineeLe, texte: `Tâche terminée : ${t.titre}` }));
}

// Autonome : filtre par acquereurId, trie par dateVisite décroissante, puis plafonne — ne dépend
// jamais implicitement de l'ordre déjà fourni par le repository appelant.
export function selectionnerComptesRendusRecents(
  comptesRendus: CompteRenduVisite[],
  acquereurId: string,
  maximum = 3
): CompteRenduVisite[] {
  return comptesRendus
    .filter((cr) => cr.acquereurId === acquereurId)
    .sort((a, b) => (a.dateVisite < b.dateVisite ? 1 : -1))
    .slice(0, maximum);
}
