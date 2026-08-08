import { cookies } from "next/headers";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const COOKIE_NAME = "atlas_google_tokens";
const ALGORITHME = "aes-256-gcm";
// Le refresh_token Google n'expire pas dans des conditions normales d'usage ;
// on garde le cookie longtemps plutôt que de forcer une reconnexion périodique inutile.
const DUREE_COOKIE_SECONDES = 60 * 60 * 24 * 180;

function cle(): Buffer {
  const b64 = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!b64) throw new Error("Variable d'environnement manquante : GOOGLE_TOKEN_ENCRYPTION_KEY");
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY doit être une clé de 32 octets encodée en base64.");
  }
  return buffer;
}

function chiffrer(texteClair: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHME, cle(), iv);
  const chiffre = Buffer.concat([cipher.update(texteClair, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, chiffre]).toString("base64");
}

function dechiffrer(valeur: string): string {
  const donnees = Buffer.from(valeur, "base64");
  const iv = donnees.subarray(0, 12);
  const tag = donnees.subarray(12, 28);
  const chiffre = donnees.subarray(28);
  const decipher = createDecipheriv(ALGORITHME, cle(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(chiffre), decipher.final()]).toString("utf8");
}

export type TokensStockes = { refreshToken: string };

// Le cookie ne contient jamais de refresh_token en clair, même chiffré au repos côté navigateur.
// L'access_token n'est jamais persisté : il est régénéré à la demande depuis le refresh_token.
export async function lireTokens(): Promise<TokensStockes | undefined> {
  const cookieStore = await cookies();
  const valeur = cookieStore.get(COOKIE_NAME)?.value;
  if (!valeur) return undefined;
  try {
    return JSON.parse(dechiffrer(valeur)) as TokensStockes;
  } catch {
    // Cookie corrompu ou clé de chiffrement changée : on traite comme "non connecté".
    return undefined;
  }
}

export async function ecrireTokens(tokens: TokensStockes): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, chiffrer(JSON.stringify(tokens)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DUREE_COOKIE_SECONDES,
  });
}

export async function supprimerTokens(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
