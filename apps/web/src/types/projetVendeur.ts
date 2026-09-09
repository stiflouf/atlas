import type { MotifPerteProspectVendeur } from "@/types/motifPerteProspectVendeur";
import type { OrigineLead } from "@/types/origineLead";

// ADR-055 §B — projet vendeur canonique : une intention de VENDRE située dans le temps.
//
// Ce type ne porte AUCUNE identité humaine : les vendeurs sont des Contacts, atteints par
// `parties_projet`. Il ne porte pas non plus la description du bien (adresse, ville, type) : elle
// décrit le bien, pas le projet, et sa frontière sera traitée par le lot Property/Mandat.
//
// `workspaceId` n'apparaît volontairement pas ici : l'appartenance est une propriété
// d'infrastructure (ADR-054) — même choix que `Bien`, `Contact` et `ProjetAcquereur`.
//
// Aucun `stadeProjet` : le statut se DÉRIVE des jalons, exactement comme
// `deriverStatutProspectVendeur()` le fait aujourd'hui (ADR-014/027). Le stocker créerait une
// seconde vérité.
export type ProjetVendeur = {
  id: string;
  origineLead?: OrigineLead;
  origineLeadDetail?: string;
  qualifieLe?: string;
  // Planifié — ne fait jamais avancer le statut (ADR-027).
  rdvEstimationPrevuLe?: string;
  // Effectivement tenu — le seul des deux qui fasse avancer le statut.
  rdvEstimationRealiseLe?: string;
  estimationProposeeCentimes?: number;
  estimationProposeeLe?: string;
  // Jalons DU PROJET, pas attributs du mandat : `mandats` n'existe pas (ADR-055 §F).
  mandatProposeLe?: string;
  mandatSigneLe?: string;
  // Issue commerciale — distincte de `archiveLe`, geste administratif (ADR-012).
  motifPerte?: MotifPerteProspectVendeur;
  datePerte?: string;
  // ADR-027 §4 : seules de vraies interactions le font avancer.
  dernierContactLe?: string;
  creeLe: string;
  archiveLe?: string;
};
