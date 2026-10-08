"use server";

import { revalidatePath } from "next/cache";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerOwnerWorkspaceCourant } from "@/lib/auth/ownerWorkspaceCourant";
import { avecFeedbackFormulaire, ErreurSaisie, type EtatFormulaire } from "@/lib/formulaires/etatFormulaire";
import { parseIdentiteResponsableFormData } from "@/lib/privacy/identiteResponsableFormulaire";
import { enregistrerIdentiteResponsable } from "@/lib/workspacePrivacyRepository";

// PRIVACY_GOVERNANCE_FOUNDATION_V1 (ADR-065) — enregistrer l'identité du responsable du traitement
// du workspace courant.
//
// Cette action ORCHESTRE et n'écrit pas : le seul writer reste `enregistrerIdentiteResponsable`.
// Même découpage que `modifierContactAction`.
//
// TROIS GARDES, dans cet ordre, et aucune n'est redondante :
//   1. `exigerSessionAtlas()` en PREMIÈRE instruction — invariant du dépôt, verrouillé par
//      gardeSessionAtlas.structurel.test.ts ;
//   2. `exigerOwnerWorkspaceCourant()` — périmètre ET rôle. Aucun identifiant de workspace n'est
//      lu du formulaire : il est RÉSOLU côté serveur depuis la session. C'est ce qui rend une
//      écriture inter-workspace impossible à formuler, plutôt que seulement refusée — un champ
//      caché falsifié n'aurait rien à falsifier ;
//   3. le refus du writer si aucune ligne n'est touchée.
//
// Aucune redirection en cas de succès : le propriétaire reste sur l'écran, qui recalcule l'état de
// complétude et affiche ce qui manque encore. Rediriger ailleurs lui cacherait précisément
// l'information qu'il est venu chercher.
export async function enregistrerIdentiteResponsableAction(
  _etatPrecedent: EtatFormulaire,
  formData: FormData
): Promise<EtatFormulaire> {
  await exigerSessionAtlas();
  return avecFeedbackFormulaire(async () => {
    const workspaceId = await exigerOwnerWorkspaceCourant();

    const champs = parseIdentiteResponsableFormData(formData);

    const enregistree = await enregistrerIdentiteResponsable(workspaceId, champs);
    if (!enregistree) throw new ErreurSaisie("Workspace introuvable.");

    revalidatePath("/parametres/confidentialite");
  });
}
