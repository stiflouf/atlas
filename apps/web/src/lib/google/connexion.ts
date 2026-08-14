import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connexionsGoogle } from "@/db/schema";

const ALGORITHME = "aes-256-gcm";
// Produit mono-conseiller : une seule connexion Google possible, toujours cette ligne (voir
// ADR-006). Pas de notion d'utilisateur/session tant que ce besoin n'existe pas réellement.
const ID_CONNEXION = "default";

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

// `scope` exposé ici (ADR-031-bis) : les capacités Calendar/Gmail réellement accordées se dérivent
// uniquement de ce champ (voir capacites.ts), jamais d'une supposition sur la route appelée.
export type ConnexionGoogle = { refreshToken: string; scope: string };

// Le refresh_token n'est jamais transmis au navigateur : il est chiffré (AES-256-GCM) et vit
// uniquement en base. L'access_token n'est jamais persisté, régénéré à la demande.
export async function lireConnexionGoogle(): Promise<ConnexionGoogle | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(connexionsGoogle)
    .where(eq(connexionsGoogle.id, ID_CONNEXION))
    .limit(1);

  if (!ligne) return undefined;

  try {
    return { refreshToken: dechiffrer(ligne.refreshTokenChiffre), scope: ligne.scope };
  } catch {
    // Ligne corrompue ou clé de chiffrement changée : traité comme non connecté.
    return undefined;
  }
}

export async function ecrireConnexionGoogle(refreshToken: string, scope: string): Promise<void> {
  const db = getDb();
  await db
    .insert(connexionsGoogle)
    .values({
      id: ID_CONNEXION,
      refreshTokenChiffre: chiffrer(refreshToken),
      scope,
    })
    .onConflictDoUpdate({
      target: connexionsGoogle.id,
      set: {
        refreshTokenChiffre: chiffrer(refreshToken),
        scope,
        modifieLe: new Date(),
      },
    });
}

export async function supprimerConnexionGoogle(): Promise<void> {
  await getDb().delete(connexionsGoogle).where(eq(connexionsGoogle.id, ID_CONNEXION));
}
