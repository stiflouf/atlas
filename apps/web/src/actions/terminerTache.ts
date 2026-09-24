"use server";

import { redirect } from "next/navigation";
import { getTacheDuWorkspace, terminerTache } from "@/lib/tacheRepository";
import { ajouterNoteProspectVendeur } from "@/lib/noteProspectVendeurRepository";
import { TYPES_NOTE_INTERACTION } from "@/types/noteProspectVendeur";
import type { TypeNoteProspectVendeur } from "@/types/noteProspectVendeur";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

// Terminer une tâche ne signifie jamais silencieusement "contact réalisé" (ADR-028) : par défaut,
// terminerTache() ne touche à rien d'autre. Exception opt-in unique, réservée aux tâches rattachées
// à un prospect vendeur (prospectVendeurId) : le formulaire peut soumettre en plus une vraie
// interaction, enregistrée via le mécanisme déjà existant d'ADR-027
// (notes_prospect_vendeur + dernierContactLe) — jamais automatique, jamais pour les autres
// domaines (bien/acquéreur/etc.) qui n'ont pas encore de journal d'interactions structuré. Deux
// écritures séquentielles plutôt qu'une transaction partagée : un échec de la seconde (rare)
// laisse la tâche terminée avec l'interaction non journalisée, un état mineur et récupérable, pas
// une incohérence grave comparable à un bien orphelin.
// WORKSPACE_SCOPING_V1 (ADR-054) — la tâche est lue ET close dans le périmètre de session : hors
// workspace, `getTacheDuWorkspace` rend `undefined` et `terminerTache` ne touche aucune ligne, donc
// aucune note d'échange n'est écrite non plus.
export async function terminerTacheAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  if (!id) {
    throw new Error("Identifiant de tâche manquant.");
  }

  const tache = await getTacheDuWorkspace(id, workspaceId);
  await terminerTache(id, workspaceId);

  const enregistrerInteraction = formData.get("enregistrerInteraction") === "on";
  if (enregistrerInteraction && tache?.prospectVendeurId) {
    const type = String(formData.get("typeInteraction") ?? "") as TypeNoteProspectVendeur;
    if (!TYPES_NOTE_INTERACTION.includes(type)) {
      throw new Error("Type d'interaction invalide.");
    }
    const contenu = String(formData.get("contenuInteraction") ?? "").trim();
    if (!contenu) {
      throw new Error("Le contenu de l'interaction ne peut pas être vide.");
    }
    // La tâche a déjà été prouvée dans ce périmètre (getTacheDuWorkspace) ; le writer le revérifie
    // sur la racine prospect, sous verrou.
    await ajouterNoteProspectVendeur(tache.prospectVendeurId, type, contenu, workspaceId);
  }

  const redirectTo = String(formData.get("redirectTo") ?? "/");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}
