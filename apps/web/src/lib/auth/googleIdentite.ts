import { OAuth2Client } from "google-auth-library";

// Flux d'identité Atlas (ADR-047) — strictement distinct de src/lib/google/oauth.ts (autorisations
// métier Calendar/Gmail) : scope "openid email" uniquement, aucun access_type=offline, aucun
// refresh_token demandé ni conservé. Répond uniquement à "qui a le droit d'entrer dans Atlas ?",
// jamais à "à quoi cette personne a-t-elle accès chez Google ?".
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function requireEnv(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

export function construireUrlAutorisationIdentite(state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: requireEnv("GOOGLE_ATLAS_REDIRECT_URI"),
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type IdentiteGoogleVerifiee = { sub: string; email: string };

// Échange le code contre un id_token puis le valide CRYPTOGRAPHIQUEMENT via google-auth-library
// (signature, émetteur, audience, expiration) — jamais un décodage JWT non vérifié. Ne retourne et
// ne conserve jamais le JWT brut ni un access_token : uniquement les deux faits nécessaires à la
// session Atlas (sub, email), une fois l'ensemble des garanties vérifié.
export async function echangerCodeEtVerifierIdentite(
  code: string,
  nonceAttendu: string
): Promise<IdentiteGoogleVerifiee> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: requireEnv("GOOGLE_ATLAS_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Échange du code d'identité Google échoué (${res.status}).`);

  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("Aucun id_token retourné par Google.");

  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken: data.id_token, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("id_token Google invalide : aucune donnée exploitable.");
  if (payload.nonce !== nonceAttendu) throw new Error("Nonce OIDC invalide : rejeu suspecté.");
  if (!payload.email) throw new Error("Aucun email présent dans l'id_token Google.");
  if (payload.email_verified === false) throw new Error("Email Google non vérifié.");

  return { sub: payload.sub, email: payload.email };
}
