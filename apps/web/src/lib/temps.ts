// Fuseau horaire unique de l'application — à centraliser ici plutôt que
// de disperser des `new Date().getHours()` dépendant de l'horloge du serveur.
export const FUSEAU_HORAIRE_APP = "Europe/Paris";

function partieHoraire(date: Date, fuseau: string): { heure: number; minute: number } {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: fuseau,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const heure = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { heure, minute };
}

export function heureDuJour(date: Date, fuseau: string = FUSEAU_HORAIRE_APP): number {
  return partieHoraire(date, fuseau).heure;
}

export function minutesDepuisMinuit(date: Date, fuseau: string = FUSEAU_HORAIRE_APP): number {
  const { heure, minute } = partieHoraire(date, fuseau);
  return heure * 60 + minute;
}

// Convertit une heure au format "10h00" en minutes depuis minuit.
export function parseHeureEnMinutes(heure: string): number {
  const [h, m] = heure.replace("h", ":").split(":");
  return parseInt(h, 10) * 60 + parseInt(m || "0", 10);
}
