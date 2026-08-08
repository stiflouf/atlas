// Sous-ensemble typé de la ressource "Event" de l'API Google Calendar v3 —
// uniquement les champs consommés par l'adaptateur.
export type GoogleEventDateTime = {
  date?: string; // Événement "toute la journée" : "YYYY-MM-DD"
  dateTime?: string; // Événement horodaté : RFC3339 (ex. "2026-08-10T10:00:00+02:00")
  timeZone?: string;
};

export type GoogleCalendarEvent = {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
};

export type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
};

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
};
