import type { RendezVous, TypeRdv } from "@/types/agenda";
import { parseHeureEnMinutes } from "./temps";

export type StatutRendezVous = "a_venir" | "en_cours" | "termine";

// Durées mockées par défaut, utilisées tant qu'aucune durée réelle n'est fournie
// (une future source comme Google Calendar donnera une heure de fin explicite).
const DUREE_PAR_DEFAUT_MINUTES: Record<TypeRdv, number> = {
  visite: 45,
  estimation: 45,
  appel: 15,
  signature: 60,
  reunion: 30,
};

export function dureeRendezVous(rdv: RendezVous): number {
  return rdv.dureeMinutes ?? DUREE_PAR_DEFAUT_MINUTES[rdv.type];
}

export function statutRendezVous(rdv: RendezVous, maintenantEnMinutes: number): StatutRendezVous {
  const debut = parseHeureEnMinutes(rdv.heure);
  const fin = debut + dureeRendezVous(rdv);
  if (maintenantEnMinutes < debut) return "a_venir";
  if (maintenantEnMinutes < fin) return "en_cours";
  return "termine";
}
