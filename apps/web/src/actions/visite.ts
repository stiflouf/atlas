"use server";

import { redirect } from "next/navigation";
import { annulerVisite, modifierDatePrevueVisite } from "@/lib/visiteRepository";

// Transition planifiee → annulee (ADR-040). Aucun motif structuré, aucune raison obligatoire —
// si le conseiller veut documenter le contexte, la note libre existante (notes_bien) suffit,
// jamais interprétée ici. Le garde WHERE statut='planifiee' (visiteRepository.annulerVisite) fait
// silencieusement échouer une seconde annulation ou une annulation d'une visite déjà réalisée —
// jamais une erreur utilisateur bloquante pour un contournement de formulaire déjà impossible
// depuis l'UI normale.
export async function annulerVisiteAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const rendezVousCalendarId = String(formData.get("rendezVousCalendarId") ?? "");

  if (id) {
    await annulerVisite(id);
  }

  redirect(`/visites/${rendezVousCalendarId}/preparer`);
}

// Report (ADR-040, §11) : modifie la date prévue de la même visite, jamais annulée+recréée.
// Restreint aux visites encore 'planifiee' (modifierDatePrevueVisite) — reporter une visite déjà
// réalisée ou annulée n'a pas de sens métier, silencieusement sans effet dans ce cas.
export async function reporterVisiteAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const rendezVousCalendarId = String(formData.get("rendezVousCalendarId") ?? "");
  const nouvelleDatePrevue = String(formData.get("nouvelleDatePrevue") ?? "").trim();

  if (id && nouvelleDatePrevue) {
    await modifierDatePrevueVisite(id, nouvelleDatePrevue);
  }

  redirect(`/visites/${rendezVousCalendarId}/preparer`);
}
