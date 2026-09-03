"use server";

import { redirect } from "next/navigation";
import { getClientById } from "@/lib/clientRepository";
import {
  archiverRepereRelationnelAcquereur,
  creerRepereRelationnelAcquereur,
  modifierRepereRelationnelAcquereur,
  restaurerRepereRelationnelAcquereur,
} from "@/lib/repereRelationnelRepository";
import {
  LONGUEUR_MAX_LIBELLE_REPERE,
  estCategorieRepereRelationnel,
  estProvenanceRepereRelationnel,
  type CategorieRepereRelationnel,
  type ProvenanceRepereRelationnel,
  type RepereRelationnel,
} from "@/types/repereRelationnel";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

// Erreurs actionnables rendues dans le formulaire (patron useActionState d'ajouterSecteurRecherche
// / envoyerEmailGmail, ADR-031-bis), jamais un throw brut qui déclencherait la page d'erreur
// générique de Next.js et ferait perdre la saisie.
export type ResultatActionRepereRelationnel =
  | { statut: "idle" }
  | { statut: "succes"; repere: RepereRelationnel }
  | { statut: "erreur"; message: string };

type ChampsValides = {
  categorie: CategorieRepereRelationnel;
  libelle: string;
  provenance: ProvenanceRepereRelationnel;
  utilisableCommunication: boolean;
};

// Validation à la frontière système (formulaire), une seule fois, partagée par la création et la
// correction. Aucune normalisation « intelligente » du libellé : un `trim`, rien d'autre — le
// texte du conseiller n'est jamais réécrit, jamais interprété, jamais soumis à un modèle.
function validerChamps(formData: FormData): { ok: true; champs: ChampsValides } | { ok: false; message: string } {
  const categorie = String(formData.get("categorie") ?? "");
  const provenance = String(formData.get("provenance") ?? "");
  const libelle = String(formData.get("libelle") ?? "").trim();

  if (!estCategorieRepereRelationnel(categorie)) {
    return { ok: false, message: "Catégorie de repère inconnue." };
  }
  if (!estProvenanceRepereRelationnel(provenance)) {
    return { ok: false, message: "Provenance de repère inconnue." };
  }
  if (libelle.length === 0) {
    return { ok: false, message: "Renseignez l'information à retenir." };
  }
  if (libelle.length > LONGUEUR_MAX_LIBELLE_REPERE) {
    return {
      ok: false,
      message: `Un repère se limite à ${LONGUEUR_MAX_LIBELLE_REPERE} caractères — pour une information plus longue, utilisez les notes du client.`,
    };
  }

  return {
    ok: true,
    champs: {
      categorie,
      libelle,
      provenance,
      // Case absente du FormData = case décochée : l'autorisation ne peut jamais résulter d'un
      // champ manquant, seulement d'une case explicitement cochée par le conseiller.
      utilisableCommunication: formData.get("utilisableCommunication") === "on",
    },
  };
}

// Relecture serveur de la cible, jamais une confiance dans l'id soumis : un acquéreur inexistant
// ou archivé ne reçoit aucun nouveau repère (même garde que ajouterSecteurRechercheAction).
async function verifierAcquereurModifiable(acquereurId: string): Promise<string | undefined> {
  if (!acquereurId) return "Acquéreur introuvable.";
  const acquereur = await getClientById(acquereurId);
  if (!acquereur) return "Acquéreur introuvable.";
  if (acquereur.archiveLe) return "Impossible d'ajouter ou de modifier un repère sur un acquéreur archivé.";
  return undefined;
}

export async function ajouterRepereRelationnelAction(
  _etatPrecedent: ResultatActionRepereRelationnel | null,
  formData: FormData
): Promise<ResultatActionRepereRelationnel> {
  await exigerSessionAtlas();
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const erreurCible = await verifierAcquereurModifiable(acquereurId);
  if (erreurCible) return { statut: "erreur", message: erreurCible };

  const validation = validerChamps(formData);
  if (!validation.ok) return { statut: "erreur", message: validation.message };

  const repere = await creerRepereRelationnelAcquereur({ acquereurId, ...validation.champs });
  return { statut: "succes", repere };
}

export async function modifierRepereRelationnelAction(
  _etatPrecedent: ResultatActionRepereRelationnel | null,
  formData: FormData
): Promise<ResultatActionRepereRelationnel> {
  await exigerSessionAtlas();
  const id = String(formData.get("id") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  const erreurCible = await verifierAcquereurModifiable(acquereurId);
  if (erreurCible) return { statut: "erreur", message: erreurCible };

  const validation = validerChamps(formData);
  if (!validation.ok) return { statut: "erreur", message: validation.message };

  const modifie = await modifierRepereRelationnelAcquereur(id, acquereurId, validation.champs);
  if (!modifie) return { statut: "erreur", message: "Ce repère n'existe plus." };

  return { statut: "succes", repere: modifie };
}

// Archivage/restauration : aucune saisie à valider (id et acquereurId proviennent de champs cachés
// posés par le serveur), donc pas d'état d'erreur inline — patron du formulaire natif classique de
// l'app, terminé par redirect() comme supprimerSecteurRechercheAction (aucune Server Action de
// mutation de ce projet n'utilise revalidatePath, voir gererPhotosBien.ts). Autorisés même sur un
// acquéreur archivé : retirer un repère devenu faux ne doit jamais dépendre de l'état commercial
// de la fiche.
export async function archiverRepereRelationnelAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const id = String(formData.get("id") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  if (!id || !acquereurId) throw new Error("Identifiant de repère manquant.");

  await archiverRepereRelationnelAcquereur(id, acquereurId);
  redirect(`/clients/${acquereurId}`);
}

export async function restaurerRepereRelationnelAction(formData: FormData): Promise<void> {
  await exigerSessionAtlas();
  const id = String(formData.get("id") ?? "");
  const acquereurId = String(formData.get("acquereurId") ?? "");
  if (!id || !acquereurId) throw new Error("Identifiant de repère manquant.");

  await restaurerRepereRelationnelAcquereur(id, acquereurId);
  redirect(`/clients/${acquereurId}`);
}
