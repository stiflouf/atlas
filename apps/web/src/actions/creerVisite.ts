"use server";

import { redirect } from "next/navigation";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { creerVisite } from "@/lib/visiteRepository";
import { routeVisiteAvecRetour, retourVisiteValide } from "@/lib/visites/retourVisite";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_CIVILE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export type ResultatActionCreationVisite = { statut: "idle" } | { statut: "erreur"; message: string };

const MESSAGE_PAR_REFUS = {
  bien_introuvable: "Ce bien est introuvable dans votre espace.",
  bien_archive: "Ce bien est archivé : aucune visite ne peut y être planifiée.",
  acquereur_introuvable: "Cet acquéreur est introuvable dans votre espace.",
  acquereur_archive: "Cet acquéreur est archivé : aucune visite ne peut être planifiée pour lui.",
} as const;

// VISIT_NATIVE_ENTRY_V1 — SEUL point d'entrée UI de la création native d'une Visite (ADR-063 :
// `creerVisite`, `rendez_vous_calendar_id` NULL, aucune dépendance Google Calendar). Compatible
// `useActionState` : un refus métier ou de saisie revient au formulaire comme message local, jamais
// une page d'erreur générique (même patron que ajouterSecteurRechercheAction). Le workspace vient
// de la session, jamais du formulaire ; `retour` est un enum fermé (jamais une URL soumise).
export async function creerVisiteAction(
  _etatPrecedent: ResultatActionCreationVisite | null,
  formData: FormData
): Promise<ResultatActionCreationVisite> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const bienId = String(formData.get("bienId") ?? "").trim();
  const acquereurId = String(formData.get("acquereurId") ?? "").trim();
  const datePrevue = String(formData.get("datePrevue") ?? "").trim();
  const retour = retourVisiteValide(String(formData.get("retour") ?? ""));

  if (!UUID_REGEX.test(bienId)) return { statut: "erreur", message: "Choisissez le bien à faire visiter." };
  if (!UUID_REGEX.test(acquereurId)) return { statut: "erreur", message: "Choisissez l'acquéreur qui visitera." };
  if (!DATE_CIVILE_REGEX.test(datePrevue) || Number.isNaN(Date.parse(`${datePrevue}T00:00:00Z`))) {
    return { statut: "erreur", message: "Indiquez la date de la visite." };
  }

  const resultat = await creerVisite({ bienId, acquereurId, datePrevue }, workspaceId);
  if (resultat.statut !== "creee") return { statut: "erreur", message: MESSAGE_PAR_REFUS[resultat.statut] };

  redirect(routeVisiteAvecRetour(resultat.visite.id, retour));
}
