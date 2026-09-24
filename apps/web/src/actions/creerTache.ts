"use server";

import { redirect } from "next/navigation";
import { creerTache } from "@/lib/tacheRepository";
import { getBienDuWorkspace } from "@/lib/bienRepository";
import { getAcquereurDuWorkspace } from "@/lib/clientRepository";
import { getProspectVendeurDuWorkspace } from "@/lib/prospectVendeurRepository";
import type { CibleTache, PrioriteTache, TypeTache } from "@/types/tache";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";
import { ErreurSaisie, avecFeedbackFormulaire, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";

function parseTexteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

// Validation serveur minimale : incohérences évidentes uniquement, pas de règle métier avancée —
// même style que l'ancien creerActionAction. bien/acquéreur/prospect vendeur archivé -> refus
// explicite (ADR-012/027).
// FORM_FEEDBACK_V1 — signature `useActionState` : un refus de saisie (titre vide, deux cibles,
// cible archivée) revient au formulaire comme message local (`ErreurSaisie`), jamais error.tsx ;
// le succès reste une redirection. Garde de session inchangée, en première instruction.
// WORKSPACE_SCOPING_V1 (ADR-054) — la cible est résolue DANS le périmètre de session. Vérifier
// seulement qu'elle existe laisserait créer une tâche de son workspace pointant un bien, un
// acquéreur ou un prospect d'un autre : la tâche serait visible ici, la cible jamais — un dossier
// fantôme. Hors périmètre, la cible est « introuvable », même message qu'un id inexistant.
export async function creerTacheAction(_etatPrecedent: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerWorkspaceCourant();
    const titre = String(formData.get("titre") ?? "").trim();
    if (!titre) {
      throw new ErreurSaisie("Titre requis.");
    }

    const bienId = parseTexteOptionnel(formData.get("bienId"));
    const acquereurId = parseTexteOptionnel(formData.get("acquereurId"));
    const prospectVendeurId = parseTexteOptionnel(formData.get("prospectVendeurId"));

    // Au plus une cible (miroir du CHECK taches_une_seule_cible_check, schema.ts) — refus explicite
    // plutôt que de choisir silencieusement laquelle garder.
    const nombreCibles = [bienId, acquereurId, prospectVendeurId].filter((v) => v !== undefined).length;
    if (nombreCibles > 1) {
      throw new ErreurSaisie("Une tâche ne peut être rattachée qu'à une seule cible à la fois.");
    }

    let cible: CibleTache | undefined;
    if (bienId) {
      const bien = await getBienDuWorkspace(bienId, workspaceId);
      if (!bien || bien.archiveLe) {
        throw new ErreurSaisie("Impossible d'ajouter une tâche à un bien archivé.");
      }
      cible = { type: "bien", id: bienId };
    } else if (acquereurId) {
      const acquereur = await getAcquereurDuWorkspace(acquereurId, workspaceId);
      if (!acquereur || acquereur.archiveLe) {
        throw new ErreurSaisie("Impossible d'ajouter une tâche à un acquéreur archivé.");
      }
      cible = { type: "acquereur", id: acquereurId };
    } else if (prospectVendeurId) {
      const prospect = await getProspectVendeurDuWorkspace(prospectVendeurId, workspaceId);
      if (!prospect || prospect.archiveLe) {
        throw new ErreurSaisie("Impossible d'ajouter une tâche à un prospect vendeur archivé.");
      }
      cible = { type: "prospectVendeur", id: prospectVendeurId };
    }

    await creerTache(
      {
        titre,
        contexte: parseTexteOptionnel(formData.get("contexte")),
        type: String(formData.get("type")) as TypeTache,
        priorite: String(formData.get("priorite")) as PrioriteTache,
        echeance: parseTexteOptionnel(formData.get("echeance")),
        origine: "manuelle",
        cible,
      },
      // ADR-054 — appartenance explicite de la tâche (table racine).
      workspaceId
    );

    const redirectTo = String(formData.get("redirectTo") ?? "/");
    redirect(redirectTo.startsWith("/") ? redirectTo : "/");
  });
}
