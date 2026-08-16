"use server";

import { chargerCapacitesGoogle } from "@/lib/google/capacites";
import { lireConnexionGoogle } from "@/lib/google/connexion";
import { rafraichirAccessToken } from "@/lib/google/oauth";
import { envoyerMessageGmail } from "@/lib/google/gmailClient";
import {
  calculerContenuHash,
  demarrerTentativeEnvoi,
  getEnvoiEmailById,
  marquerEnvoiEchoue,
  marquerEnvoiIncertain,
  marquerEnvoiReussi,
} from "@/lib/envoiEmailRepository";
import { ajouterNoteProspectVendeur } from "@/lib/noteProspectVendeurRepository";
import { deriverEtatEnvoiEmail } from "@/types/envoiEmail";
import type { IntentionCommunication } from "@/lib/communications/contexteCommunication";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

export type ResultatActionEnvoiEmail =
  | { statut: "idle" }
  | { statut: "envoye" }
  | { statut: "deja_envoye" }
  | { statut: "incertain" }
  | { statut: "echec"; message: string };

const INTENTIONS_VALIDES: IntentionCommunication[] = [
  "relance_prospect_vendeur",
  "suivi_rdv_estimation",
  "suivi_acquereur",
  "suivi_visite",
  "demande_document_manquant",
  "relance_piece_a_verifier",
  "message_compromis",
  "message_notaire",
  "retour_vendeur_apres_visite",
];

function texteOptionnel(valeur: FormDataEntryValue | null): string | undefined {
  const texte = String(valeur ?? "").trim();
  return texte !== "" ? texte : undefined;
}

function parseIntentionOptionnelle(valeur: FormDataEntryValue | null): IntentionCommunication | undefined {
  return INTENTIONS_VALIDES.includes(valeur as IntentionCommunication) ? (valeur as IntentionCommunication) : undefined;
}

// Écrit l'interaction ADR-027 SEULEMENT si l'envoi Gmail est un succès CONFIRMÉ (appelé après
// marquerEnvoiReussi uniquement) et si le destinataire résolu était un prospect vendeur — jamais
// pour un acquéreur (aucun journal d'interaction structuré n'existe pour ce domaine, limite
// documentée, jamais comblée en écrivant ailleurs). Contenu court (objet uniquement) — jamais une
// copie intégrale du corps. Échec de cette écriture secondaire : n'invalide jamais le succès de
// l'envoi lui-même (même principe que terminerTacheAction, ADR-028) — juste journalisé.
async function enregistrerInteractionSiPertinent(
  destinataireType: string | undefined,
  destinataireId: string | undefined,
  objet: string
): Promise<void> {
  if (destinataireType !== "prospectVendeur" || !destinataireId) return;
  try {
    await ajouterNoteProspectVendeur(destinataireId, "email", `Email envoyé — Objet : ${objet}`);
  } catch (erreur) {
    console.error("[envoi-email] échec de l'enregistrement de l'interaction ADR-027 :", erreur);
  }
}

// Confirmation humaine déjà actée avant cet appel (écran de confirmation, BrouillonEmailFormulaire)
// — cette action ne fait que : (1) garantir l'idempotence par clé cliente, (2) revérifier le scope
// Gmail côté serveur (jamais confiance dans l'affichage client), (3) envoyer, (4) journaliser le
// résultat factuellement, (5) déclencher l'interaction ADR-027 uniquement sur succès réel. Prend
// uniquement la version finale déjà éditée — ne recalcule jamais les faits, ne réinterprète jamais
// le dossier, aucun LLM, ne décide jamais du destinataire.
export async function envoyerEmailGmailAction(
  _etatPrecedent: ResultatActionEnvoiEmail | null,
  formData: FormData
): Promise<ResultatActionEnvoiEmail> {
  await exigerSessionAtlas();
  const idempotencyKey = texteOptionnel(formData.get("idempotencyKey"));
  const destinataireEmail = texteOptionnel(formData.get("destinataireEmail"));
  const objet = String(formData.get("objet") ?? "");
  const corps = String(formData.get("corps") ?? "");
  const destinataireType = texteOptionnel(formData.get("destinataireType"));
  const destinataireId = texteOptionnel(formData.get("destinataireId"));
  const tacheId = texteOptionnel(formData.get("tacheId"));
  const bienId = texteOptionnel(formData.get("bienId"));
  const origineIntention = parseIntentionOptionnelle(formData.get("origineIntention"));

  if (!idempotencyKey || !destinataireEmail) {
    return { statut: "echec", message: "Requête invalide — destinataire ou clé d'envoi manquante." };
  }

  const capacites = await chargerCapacitesGoogle();
  if (!capacites.gmailAutorise) {
    return { statut: "echec", message: "Gmail n'est pas autorisé — autorisez Gmail avant d'envoyer." };
  }

  const contenuHash = calculerContenuHash(destinataireEmail, objet, corps);
  const tentative = await demarrerTentativeEnvoi({
    id: idempotencyKey,
    destinataireEmail,
    objet,
    contenuHash,
    bienId,
    tacheId,
    origineIntention,
  });

  if (!tentative) {
    // Conflit sur la clé d'idempotence : une tentative existe déjà pour cet écran de confirmation
    // précis — jamais un second appel Gmail.
    const existante = await getEnvoiEmailById(idempotencyKey);
    if (!existante) return { statut: "echec", message: "Tentative introuvable." };
    const etat = deriverEtatEnvoiEmail(existante);
    if (etat === "envoye") return { statut: "deja_envoye" };
    if (etat === "echec") {
      return { statut: "echec", message: "L'envoi précédent a échoué — relancez une nouvelle tentative." };
    }
    // "incertain" ou "en_cours" : jamais de renvoi automatique.
    return { statut: "incertain" };
  }

  const connexion = await lireConnexionGoogle();
  if (!connexion) {
    await marquerEnvoiEchoue(idempotencyKey, "authentification_google_absente");
    return { statut: "echec", message: "Gmail n'est plus connecté." };
  }

  let accessToken: string;
  try {
    ({ accessToken } = await rafraichirAccessToken(connexion.refreshToken));
  } catch {
    await marquerEnvoiEchoue(idempotencyKey, "authentification_google_invalide");
    return { statut: "echec", message: "La connexion Gmail a expiré — reconnectez Gmail." };
  }

  const resultat = await envoyerMessageGmail(accessToken, destinataireEmail, objet, corps);

  if (resultat.type === "succes") {
    await marquerEnvoiReussi(idempotencyKey, resultat.gmailMessageId);
    await enregistrerInteractionSiPertinent(destinataireType, destinataireId, objet);
    return { statut: "envoye" };
  }

  if (resultat.type === "incertain") {
    await marquerEnvoiIncertain(idempotencyKey, resultat.erreurTechnique);
    return { statut: "incertain" };
  }

  await marquerEnvoiEchoue(idempotencyKey, resultat.erreurTechnique);
  return { statut: "echec", message: "L'envoi via Gmail a échoué." };
}
