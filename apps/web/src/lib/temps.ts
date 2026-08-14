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

// Formate une date en "10h00", dans le fuseau donné.
export function formatHeureFr(date: Date, fuseau: string = FUSEAU_HORAIRE_APP): string {
  const { heure, minute } = partieHoraire(date, fuseau);
  return `${heure}h${String(minute).padStart(2, "0")}`;
}

// Formate une date en "YYYY-MM-DD", dans le fuseau donné (jour calendaire local).
export function formatDateISO(date: Date, fuseau: string = FUSEAU_HORAIRE_APP): string {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: fuseau }).format(date);
}

function versMidiUTC(dateCivileISO: string): number {
  const [annee, mois, jour] = dateCivileISO.split("-").map(Number);
  return Date.UTC(annee, mois - 1, jour, 12);
}

// Différence en jours civils entre deux dates "YYYY-MM-DD" (jusqu'à - depuis), comparées à midi
// UTC pour ignorer tout décalage d'heure d'été/hiver — jamais une simple soustraction de
// millisecondes sur deux timestamps complets, qui serait fausse de ±1h lors d'un changement DST.
function differenceJoursCivils(depuisISO: string, jusquaISO: string): number {
  return Math.round((versMidiUTC(jusquaISO) - versMidiUTC(depuisISO)) / 86_400_000);
}

// Formate une date "YYYY-MM-DD" relative à aujourd'hui ("Demain" à J+1, sinon "lun. 18 août"),
// pour les rendez-vous à venir.
export function formatDateRelative(dateISO: string, aujourdHuiISO: string): string {
  const diffJours = differenceJoursCivils(aujourdHuiISO, dateISO);
  if (diffJours === 1) return "Demain";
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(versMidiUTC(dateISO)));
}

// Nombre de jours civils PLEINS écoulés entre `dateReference` et `maintenant`, dans le fuseau
// donné (ADR-033) — ex. pour mesurer un silence prospect. Les deux instants sont réduits à leur
// date calendaire dans ce fuseau avant d'être différenciés : jamais un calcul en millisecondes
// brutes, qui déraillerait d'une heure lors d'un changement d'heure été/hiver.
export function joursCivilsEcoules(dateReference: Date, maintenant: Date, fuseau: string = FUSEAU_HORAIRE_APP): number {
  return differenceJoursCivils(formatDateISO(dateReference, fuseau), formatDateISO(maintenant, fuseau));
}
