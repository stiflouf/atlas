"use server";

import { redirect } from "next/navigation";
import { annulerVisite, materialiserVisite, modifierDatePrevueVisite } from "@/lib/visiteRepository";
import { getRendezVousAvecContexte } from "@/lib/rendezVousContexte";
import { getBienById } from "@/lib/bienRepository";
import { getClientById } from "@/lib/clientRepository";
import { formatDateISO } from "@/lib/temps";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matérialisation explicite (ADR-041, correction du défaut GET-mutant d'ADR-040) : seul point
// d'écriture créant une ligne `visites`, déclenché uniquement par la soumission du formulaire
// "Enregistrer et préparer cette visite" — plus jamais par le simple GET de la page de
// préparation. Ne fait confiance qu'à `rendezVousCalendarId` soumis par le formulaire (routage,
// déjà exposé dans l'URL) — bien/acquéreur sont re-résolus ici via la même fonction que la page
// (`getRendezVousAvecContexte`, jamais une seconde logique de matching), jamais un `bienId`/
// `acquereurId` client fourni sans revalidation. Idempotente au niveau DB (UNIQUE sur
// `rendez_vous_calendar_id`, `materialiserVisite`) : un double submit ne crée jamais deux visites.
export async function materialiserVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const rendezVousCalendarId = String(formData.get("rendezVousCalendarId") ?? "");

  if (rendezVousCalendarId) {
    const resultat = await getRendezVousAvecContexte(rendezVousCalendarId);
    if (resultat?.contexte.bien && resultat.contexte.client) {
      const [bien, acquereur] = await Promise.all([
        getBienById(resultat.contexte.bien.bienId),
        getClientById(resultat.contexte.client.clientId),
      ]);
      // Aucun fallback mock : seuls de vrais UUID persistés matérialisent une visite (même garde
      // que l'ancien comportement ADR-040, jamais régressée).
      if (bien && acquereur && UUID_REGEX.test(bien.id) && UUID_REGEX.test(acquereur.id)) {
        await materialiserVisite({
          bienId: bien.id,
          acquereurId: acquereur.id,
          datePrevue: resultat.rdv.date ?? formatDateISO(new Date()),
          rendezVousCalendarId,
        });
      }
    }
    redirect(`/visites/${rendezVousCalendarId}/preparer`);
  }

  redirect("/");
}

// Transition planifiee → annulee (ADR-040). Aucun motif structuré, aucune raison obligatoire —
// si le conseiller veut documenter le contexte, la note libre existante (notes_bien) suffit,
// jamais interprétée ici. Le garde WHERE statut='planifiee' (visiteRepository.annulerVisite) fait
// silencieusement échouer une seconde annulation ou une annulation d'une visite déjà réalisée —
// jamais une erreur utilisateur bloquante pour un contournement de formulaire déjà impossible
// depuis l'UI normale.
export async function annulerVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const id = String(formData.get("id") ?? "");
  const rendezVousCalendarId = String(formData.get("rendezVousCalendarId") ?? "");
  // redirectTo optionnel (ADR-041, même patron que terminerTacheAction) : la fiche Visite
  // (/visites/{idAtlas}) redirige vers elle-même ; la page de préparation garde son comportement
  // par défaut inchangé si le champ est absent.
  const redirectTo = String(formData.get("redirectTo") ?? "") || `/visites/${rendezVousCalendarId}/preparer`;

  if (id) {
    await annulerVisite(id);
  }

  redirect(redirectTo);
}

// Report (ADR-040, §11) : modifie la date prévue de la même visite, jamais annulée+recréée.
// Restreint aux visites encore 'planifiee' (modifierDatePrevueVisite) — reporter une visite déjà
// réalisée ou annulée n'a pas de sens métier, silencieusement sans effet dans ce cas.
export async function reporterVisiteAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const id = String(formData.get("id") ?? "");
  const rendezVousCalendarId = String(formData.get("rendezVousCalendarId") ?? "");
  const nouvelleDatePrevue = String(formData.get("nouvelleDatePrevue") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "") || `/visites/${rendezVousCalendarId}/preparer`;

  if (id && nouvelleDatePrevue) {
    await modifierDatePrevueVisite(id, nouvelleDatePrevue);
  }

  redirect(redirectTo);
}
