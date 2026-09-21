import type { RendezVous } from "@/types/agenda";
import type { VisiteDuJour } from "@/lib/visiteRepository";

// VISIT_NATIVE_ENTRY_V1 — fusion de l'agenda du jour : rendez-vous Calendar (source externe,
// éphémère) + Visites DOMIORA (source canonique, persistée). Fonction pure, sans I/O.
//
// Règles (brief §14-§18) :
//   - une Visite matérialisée depuis Calendar (`rendezVousCalendarId`) et son événement Calendar sont
//     LE MÊME rendez-vous : l'événement est retiré, la Visite canonique est préférée (lien
//     /visites/{id}, jamais /preparer par défaut) ;
//   - une Visite `annulee` ou `realisee` n'est pas un rendez-vous actif : elle n'est pas affichée ET
//     son événement Calendar ne réapparaît pas pour autant (c'est pour cela que le reader remonte
//     TOUS les statuts du jour, jamais seulement `planifiee`) ;
//   - une Visite native `planifiee` (sans Calendar) est affichée ; un événement Calendar sans Visite
//     reste affiché tel quel.
// Rien n'est trié entre les deux familles : la Visite n'a pas d'heure (jour civil, ADR-040/041),
// elle se lit avant les rendez-vous horodatés, comme un événement « journée entière ».
export type AgendaDuJourFusionne = {
  visites: VisiteDuJour[];
  rendezVous: RendezVous[];
};

export function fusionnerAgendaDuJour(rendezVous: RendezVous[], visitesDuJour: VisiteDuJour[]): AgendaDuJourFusionne {
  const calendarIdsMaterialises = new Set(
    visitesDuJour.map((v) => v.rendezVousCalendarId).filter((id): id is string => Boolean(id))
  );
  return {
    visites: visitesDuJour.filter((v) => v.statut === "planifiee"),
    rendezVous: rendezVous.filter((rdv) => !calendarIdsMaterialises.has(rdv.id)),
  };
}
