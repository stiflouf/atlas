"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { ErreurAcquereurHorsPerimetre, getAcquereurDuWorkspace } from "@/lib/clientRepository";
import { ajouterSecteurRecherche, supprimerSecteurRecherche } from "@/lib/secteurRechercheRepository";
import { verifierCommune } from "@/lib/geocodage/ignClient";
import { enqueuerResynchronisationAcquereur } from "@/lib/compatibilite/resynchronisationRepository";
import { traiterDemandeResynchronisation } from "@/lib/compatibilite/traitementResynchronisation";
import type { SecteurRecherche } from "@/types/secteurRecherche";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";
import { exigerWorkspaceCourant } from "@/lib/auth/workspaceCourant";

export type ResultatActionAjoutSecteur =
  | { statut: "idle" }
  | { statut: "succes"; secteur: SecteurRecherche }
  | { statut: "erreur"; message: string };

// Correction obligatoire (ADR-035, section 8) : le client soumet codeInsee/nomCommune choisis dans
// l'autocomplétion, mais le serveur ne leur fait jamais confiance tels quels — trois hidden inputs
// restent manipulables. verifierCommune() rejoue une recherche IGN fraîche filtrée par citycode ;
// seule sa réponse (jamais les valeurs soumises) est persistée. Si l'IGN est indisponible ou ne
// confirme pas la sélection : aucune écriture, erreur explicite actionnable (jamais un throw brut :
// compatible useActionState, comme envoyerEmailGmailAction ADR-031-bis, pour un message affiché
// dans le formulaire plutôt qu'une page d'erreur générique) — mieux vaut ne rien enregistrer qu'un
// identifiant géographique douteux.
export async function ajouterSecteurRechercheAction(
  _etatPrecedent: ResultatActionAjoutSecteur | null,
  formData: FormData
): Promise<ResultatActionAjoutSecteur> {
  await exigerSessionAtlas();
  // WORKSPACE_SCOPING_V2A (ADR-054) — ce périmètre ne sert plus seulement à ESTAMPILLER la demande
  // de resynchronisation : il prouve d'abord que l'acquéreur visé est bien le nôtre. Sans cela, un
  // id d'un autre workspace faisait naître dans CE workspace une demande — puis des paires de
  // compatibilité — pointant une personne qui n'y appartient pas.
  const workspaceId = await exigerWorkspaceCourant();
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const codeInsee = String(formData.get("codeInsee") ?? "").trim();
  const nomCommune = String(formData.get("nomCommune") ?? "").trim();
  if (!acquereurId || !codeInsee || !nomCommune) {
    return { statut: "erreur", message: "Sélection de secteur incomplète — recherchez et sélectionnez une commune." };
  }

  const acquereur = await getAcquereurDuWorkspace(acquereurId, workspaceId);
  if (!acquereur || acquereur.archiveLe) {
    return { statut: "erreur", message: "Impossible d'ajouter un secteur de recherche à un acquéreur archivé." };
  }

  const communeVerifiee = await verifierCommune(codeInsee, nomCommune);
  if (!communeVerifiee) {
    return {
      statut: "erreur",
      message: "Impossible de vérifier cette commune auprès de l'IGN pour le moment. Réessayez dans un instant.",
    };
  }

  try {
    // Ajout + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) — un nouveau secteur
    // peut rendre compatibles des paires qui ne l'étaient pas, jamais un scan de fond N×M : seul
    // cet unique acquéreur est resynchronisé (synchroniserCompatibilitesPourAcquereur).
    const { secteur, idDemandeResynchronisation } = await getDb().transaction(async (tx) => {
      const secteur = await ajouterSecteurRecherche(acquereurId, communeVerifiee, workspaceId, tx);
      const idDemandeResynchronisation = await enqueuerResynchronisationAcquereur(acquereurId, workspaceId, tx);
      return { secteur, idDemandeResynchronisation };
    });
    await traiterDemandeResynchronisation(idDemandeResynchronisation);
    return { statut: "succes", secteur };
  } catch (erreur) {
    // Contrainte UNIQUE(acquereur_id, code_insee) — code Postgres 23505. drizzle-orm/postgres-js
    // enveloppe l'erreur Postgres d'origine dans `cause` (le message de haut niveau, "Failed
    // query: ...", ne contient jamais le code) — vérifié empiriquement lors d'ADR-028. Traduit en
    // message actionnable plutôt que de laisser remonter une erreur SQL brute.
    const cause = erreur instanceof Error ? erreur.cause : undefined;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
      return {
        statut: "erreur",
        message: `${communeVerifiee.nom} est déjà enregistrée comme secteur recherché pour cet acquéreur.`,
      };
    }
    throw erreur;
  }
}

// Suppression : aucune vérification externe nécessaire (id/acquereurId proviennent de champs
// cachés posés par le serveur, jamais saisis par le conseiller) — reste sur le patron
// redirect()/formulaire natif classique de l'app (comme annulerTacheAction), pas besoin de
// useActionState ici.
export async function supprimerSecteurRechercheAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const workspaceId = await exigerWorkspaceCourant();
  const id = String(formData.get("id") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  if (!id || !acquereurId) {
    throw new Error("Identifiant de secteur manquant.");
  }

  // Suppression + enqueue de resynchronisation dans LA MÊME transaction (ADR-036) — un secteur
  // retiré peut sortir des paires de la compatibilité géographique (0 événement, l'état technique
  // est simplement mis à jour, voir synchronisation.ts).
  // WORKSPACE_SCOPING_V2A — la preuve d'appartenance est prise sous verrou DANS cette transaction
  // (supprimerSecteurRecherche) : hors périmètre, elle lève, la transaction est annulée entière et
  // ni la suppression ni la demande de resynchronisation n'existent. L'écran se comporte alors
  // comme pour un secteur déjà supprimé — aucune distinction offerte à l'appelant.
  let idDemandeResynchronisation: string | undefined;
  try {
    idDemandeResynchronisation = await getDb().transaction(async (tx) => {
      await supprimerSecteurRecherche(id, acquereurId, workspaceId, tx);
      return enqueuerResynchronisationAcquereur(acquereurId, workspaceId, tx);
    });
  } catch (erreur) {
    if (!(erreur instanceof ErreurAcquereurHorsPerimetre)) throw erreur;
  }
  if (idDemandeResynchronisation) await traiterDemandeResynchronisation(idDemandeResynchronisation);

  const redirectTo = String(formData.get("redirectTo") ?? `/clients/${acquereurId}`);
  redirect(redirectTo.startsWith("/") ? redirectTo : `/clients/${acquereurId}`);
}
