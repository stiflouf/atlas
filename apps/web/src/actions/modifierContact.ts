"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { estContactFusionne } from "@/lib/contactFusion";
import { getContactDuWorkspace, modifierIdentiteContact } from "@/lib/contactRepository";
import { identiteIdentique, parseContactFormData } from "@/lib/contactFormulaire";
import { avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

// ADR-057 — corriger l'identité canonique d'une personne DEPUIS sa fiche, sans passer par un
// dossier. Cette action ORCHESTRE ; elle n'écrit pas : le seul writer de `contacts` reste
// `modifierIdentiteContact`, qui porte la vérification de périmètre, `modifie_le` et les verrous
// humains (ADR-056 §4) sur les seuls champs réellement changés.
//
// Elle ne touche à rien d'autre : aucun dossier historique n'est réécrit (les instantanés
// `acquereurs`/`prospects_vendeurs` restent ce qu'ils étaient), aucun `contact_id` ne bouge, aucun
// contact n'est créé ni rapproché — un email devenu identique à celui d'un autre contact est
// autorisé tel quel (ADR-055 §H : deux personnes peuvent partager une adresse).
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DEMO_UX_HARDENING_V1 — FORM_FEEDBACK_V1 : `parseContactFormData` lève déjà `ErreurSaisie`
// (« Le nom est obligatoire. ») pour un nom composé d'espaces, que `required` côté navigateur
// laisse passer. Elle revient désormais au formulaire au lieu de remonter en page d'erreur. Le
// `notFound()` et le `redirect()` traversent le helper intacts, et l'invariant du writer lève
// toujours.
export async function modifierContactAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    // ADR-054 — trois gardes de périmètre : ici, à la lecture, et dans le writer.
    const workspaceId = await exigerWorkspaceCourant();
    const id = String(formData.get("id") ?? "");
    if (!UUID_REGEX.test(id)) notFound();

    const saisie = parseContactFormData(formData);

    const actuel = await getContactDuWorkspace(id, workspaceId);
    // ADR-059 — un contact absorbé est figé ; le writer le refuse aussi, ceci évite une erreur.
    if (!actuel || estContactFusionne(actuel)) notFound();

    // Soumission à l'identique : ni UPDATE, ni verrou, ni `modifie_le` déplacé — rouvrir un formulaire
    // et le réenregistrer n'est pas une correction.
    if (!identiteIdentique(actuel, saisie)) {
      // Identité et verrous dans la même transaction : un contact corrigé sans son verrou serait
      // réécrit par la prochaine synchronisation, comme si personne n'avait rien décidé.
      await getDb().transaction(async (tx) => {
        const contact = await modifierIdentiteContact(id, saisie, workspaceId, tx);
        if (!contact) throw new Error("Contact introuvable.");
      });
    }

    redirect(`/contacts/${id}`);
  });
}
