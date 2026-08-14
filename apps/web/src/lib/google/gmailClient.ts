import { ErreurConstructionEmail, construireMessageRaw } from "./mimeEmail";

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const TIMEOUT_MS = 15_000;

// Trois issues, jamais deux : un succès ("Envoi confirmé par Gmail" — jamais "reçu"/"délivré",
// users.messages.send ne renseigne pas cette information), un échec CONNU (une réponse HTTP a
// effectivement été reçue de Google, non-2xx), ou un résultat INCERTAIN (aucune réponse
// exploitable reçue — réseau rompu, timeout, corps illisible, ou 2xx sans identifiant de message
// valide) — jamais assimilé à un échec net, jamais assimilé à un succès (ADR-031-bis).
export type ResultatEnvoiGmail =
  | { type: "succes"; gmailMessageId: string }
  | { type: "echec"; erreurTechnique: string }
  | { type: "incertain"; erreurTechnique: string };

export async function envoyerMessageGmail(
  accessToken: string,
  destinataireEmail: string,
  objet: string,
  corps: string
): Promise<ResultatEnvoiGmail> {
  let raw: string;
  try {
    raw = construireMessageRaw(destinataireEmail, objet, corps);
  } catch (erreur) {
    const message = erreur instanceof ErreurConstructionEmail ? erreur.message : "message_invalide";
    return { type: "echec", erreurTechnique: message };
  }

  const controller = new AbortController();
  const delai = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let reponse: Response;
  try {
    reponse = await fetch(SEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: controller.signal,
    });
  } catch {
    // Rupture réseau ou timeout AVANT toute réponse HTTP exploitable : impossible de savoir si
    // Google a reçu et traité l'appel — jamais un échec net.
    return { type: "incertain", erreurTechnique: "reseau_ou_timeout" };
  } finally {
    clearTimeout(delai);
  }

  if (!reponse.ok) {
    // Réponse HTTP effectivement reçue et refusée par Google : un résultat CONNU, pas ambigu.
    const categorie = reponse.status === 401 || reponse.status === 403 ? "authentification_google_invalide" : "erreur_google";
    return { type: "echec", erreurTechnique: `${categorie}_${reponse.status}` };
  }

  let corpsReponse: unknown;
  try {
    corpsReponse = await reponse.json();
  } catch {
    // 2xx reçu mais corps illisible : Google a peut-être traité l'envoi sans qu'on puisse le
    // confirmer — incertain, jamais un succès supposé.
    return { type: "incertain", erreurTechnique: "reponse_illisible" };
  }

  const id = (corpsReponse as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id.length === 0) {
    return { type: "incertain", erreurTechnique: "reponse_sans_identifiant" };
  }

  return { type: "succes", gmailMessageId: id };
}
