import type { GoogleCalendarEvent, GoogleCalendarEventsResponse } from "@/types/googleCalendar";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
// Garde-fou : évite une boucle de pagination indéfinie en cas de réponse anormale de l'API.
const MAX_PAGES = 10;

export async function listerEvenements(
  accessToken: string,
  fenetre: { timeMinISO: string; timeMaxISO: string }
): Promise<GoogleCalendarEvent[]> {
  const evenements: GoogleCalendarEvent[] = [];
  let pageToken: string | undefined;
  let page = 0;

  do {
    const params = new URLSearchParams({
      timeMin: fenetre.timeMinISO,
      timeMax: fenetre.timeMaxISO,
      singleEvents: "true",
      orderBy: "startTime",
      timeZone: "Europe/Paris",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${EVENTS_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Google Calendar API : ${res.status}`);

    const data = (await res.json()) as GoogleCalendarEventsResponse;
    evenements.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    page += 1;
  } while (pageToken && page < MAX_PAGES);

  return evenements;
}

// Récupère un événement précis par id — utilisé quand on doit ré-établir le contexte d'un
// rendez-vous déjà rencontré (ex. ouverture de la page de préparation), sans conserver
// d'état entre le chargement de l'agenda et cette consultation.
export async function recupererEvenement(
  accessToken: string,
  eventId: string
): Promise<GoogleCalendarEvent | undefined> {
  const res = await fetch(`${EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 410) return undefined;
  if (!res.ok) throw new Error(`Google Calendar API : ${res.status}`);
  return (await res.json()) as GoogleCalendarEvent;
}
