import type { GoogleTokenResponse } from "@/types/googleCalendar";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Lecture seule uniquement — aucune écriture dans le calendrier n'est possible avec ce scope.
export const SCOPE_CALENDAR_READONLY = "https://www.googleapis.com/auth/calendar.events.readonly";
// Envoi seul (ADR-031-bis) : ni lecture, ni recherche, ni suppression, ni labels, ni pièces
// jointes reçues — principe de moindre privilège appliqué au strict besoin de `users.messages.send`.
// Scope classé "Sensitive" (pas "Restricted") par Google au moment de l'écriture — une vérification
// de l'application par Google peut néanmoins être nécessaire avant un usage public en production,
// indépendamment de ce code (voir docs/KNOWN_LIMITATIONS.md).
export const SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";

function requireEnv(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

// Même rationale que googleIdentite.ts::origineIdentitePublique() (bugfix déploiement) —
// GOOGLE_REDIRECT_URI est déjà l'unique source de vérité du domaine public pour le flux métier
// Calendar/Gmail, jamais request.url/request.nextUrl derrière un proxy.
export function origineMetierPublique(): string {
  return new URL(requireEnv("GOOGLE_REDIRECT_URI")).origin;
}

// `scopes` explicite plutôt qu'une constante unique (ADR-031-bis) : Calendar et Gmail sont deux
// capacités demandées indépendamment, jamais couplées dans ce code — chaque flux d'autorisation
// demande exactement ce dont il a besoin. `include_granted_scopes=true` (toujours actif) laisse
// Google plier les scopes déjà accordés dans le nouveau refresh_token (autorisation incrémentale
// native) plutôt que de recomposer nous-mêmes une union de scopes à chaque demande.
//
// Ne force le consentement Google (et donc l'émission d'un nouveau refresh_token) que lorsque
// c'est nécessaire : première connexion, reconnexion explicite après un refresh_token invalide,
// ou demande d'une nouvelle capacité (Gmail) où un refresh_token est requis à coup sûr.
export function construireUrlAutorisation(state: string, forcerConsentement: boolean, scopes: string[]): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    state,
    include_granted_scopes: "true",
  });
  if (forcerConsentement) params.set("prompt", "consent");
  return `${AUTH_URL}?${params.toString()}`;
}

export type TokensGoogle = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};

export async function echangerCodeContreTokens(code: string): Promise<TokensGoogle> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Échange du code OAuth échoué (${res.status})`);

  // Garde défensive (ADR-031-bis, correction explicite) : `TokensGoogle.refreshToken` est typé
  // `string`, jamais optionnel — l'appelant (le callback) ne peut donc jamais écraser un
  // refresh_token valide déjà stocké par `undefined` si cet échange n'en retourne pas un.
  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.refresh_token) {
    throw new Error(
      "Aucun refresh_token retourné par Google — une reconnexion avec consentement forcé est nécessaire."
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

export async function rafraichirAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Rafraîchissement du token Google échoué (${res.status})`);

  const data = (await res.json()) as GoogleTokenResponse;
  return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

// La révocation est une bonne pratique de déconnexion, pas une garantie : on ne bloque jamais
// la déconnexion locale (suppression de la connexion en base) si l'appel à Google échoue.
export async function revoquerToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch (erreur) {
    console.error("[google-calendar] échec de la révocation du token :", erreur);
  }
}
