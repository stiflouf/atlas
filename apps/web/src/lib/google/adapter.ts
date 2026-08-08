import type { GoogleCalendarEvent } from "@/types/googleCalendar";
import type { RendezVous } from "@/types/agenda";
import { FUSEAU_HORAIRE_APP, formatDateISO, formatHeureFr } from "@/lib/temps";

function dureeEnMinutes(debut: Date, fin: Date): number {
  return Math.round((fin.getTime() - debut.getTime()) / 60000);
}

// Transforme un événement Google Calendar en RendezVous du modèle interne.
// Pas de déduction du type (visite/appel/...) depuis le texte : tout événement
// externe est mappé vers le type générique "evenement" pour l'instant.
export function toRendezVous(event: GoogleCalendarEvent): RendezVous | null {
  if (event.status === "cancelled") return null;
  if (!event.start) return null;

  const titre = event.summary?.trim() || "Sans titre";

  if (event.start.date) {
    // Événement "toute la journée" : pas d'heure ni de durée à calculer.
    return {
      id: `gcal-${event.id}`,
      heure: "00h00",
      journeeEntiere: true,
      date: event.start.date,
      type: "evenement",
      titre,
      lieu: event.location,
      preparationDisponible: false,
    };
  }

  if (!event.start.dateTime || !event.end?.dateTime) return null;

  const debut = new Date(event.start.dateTime);
  const fin = new Date(event.end.dateTime);

  return {
    id: `gcal-${event.id}`,
    heure: formatHeureFr(debut, FUSEAU_HORAIRE_APP),
    dureeMinutes: dureeEnMinutes(debut, fin),
    date: formatDateISO(debut, FUSEAU_HORAIRE_APP),
    type: "evenement",
    titre,
    lieu: event.location,
    preparationDisponible: false,
  };
}
