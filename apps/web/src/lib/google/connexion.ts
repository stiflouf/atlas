import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connexionsGoogle } from "@/db/schema";

const ALGORITHME = "aes-256-gcm";

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

// WORKSPACE_SCOPING_V2D2 (ADR-054 §6) — `identiteSub` est OBLIGATOIRE sur les trois fonctions de ce
// module, et c'est tout le lot : jusqu'ici elles ne prenaient AUCUN paramètre et visaient toujours
// la même ligne (`id = 'default'`). Un token OAuth appartient à la personne qui l'a accordé, jamais
// à l'instance ni au workspace — deux conseillers ont deux comptes Google, deux agendas, deux
// boîtes mail.
//
// `identiteSub` vient de `DonneesSessionAtlas.sub` (ADR-047), jamais d'un champ de formulaire ni
// d'un paramètre d'URL : c'est une identité prouvée par cookie scellé, pas une valeur soumise.
//
// Le refresh_token n'est jamais transmis au navigateur : il est chiffré (AES-256-GCM) et vit
// uniquement en base. L'access_token n'est jamais persisté, régénéré à la demande.
export async function lireConnexionGoogle(identiteSub: string): Promise<ConnexionGoogle | undefined> {
  const [ligne] = await getDb()
    .select()
    .from(connexionsGoogle)
    .where(eq(connexionsGoogle.identiteSub, identiteSub))
    .limit(1);

  if (!ligne) return undefined;

  try {
    return { refreshToken: dechiffrer(ligne.refreshTokenChiffre), scope: ligne.scope };
  } catch (erreur) {
    // Ligne corrompue ou clé de chiffrement changée : traité comme non connecté. Le message
    // d'erreur crypto (ex. "Unsupported state or unable to authenticate data") ne contient jamais
    // la clé ni le texte chiffré/déchiffré — sûr à journaliser tel quel (bugfix pilote : ce cas
    // était auparavant totalement invisible des logs).
    console.error(
      "[gmail] déchiffrement de la connexion Google impossible :",
      erreur instanceof Error ? erreur.message : "erreur inconnue"
    );
    return undefined;
  }
}

// La cible de l'`ON CONFLICT` est l'IDENTITÉ : une reconnexion remplace le token de CETTE personne
// et d'aucune autre. Avant ce lot la cible était `id`, constante — chaque connexion écrasait donc
// celle du membre précédent, en silence.
export async function ecrireConnexionGoogle(
  identiteSub: string,
  refreshToken: string,
  scope: string
): Promise<void> {
  const db = getDb();
  await db
    .insert(connexionsGoogle)
    .values({
      identiteSub,
      refreshTokenChiffre: chiffrer(refreshToken),
      scope,
    })
    .onConflictDoUpdate({
      target: connexionsGoogle.identiteSub,
      set: {
        refreshTokenChiffre: chiffrer(refreshToken),
        scope,
        modifieLe: new Date(),
      },
    });
}

// Supprime la connexion d'UNE personne. Un `DELETE` sans `WHERE` d'identité déconnecterait tout le
// monde — c'est exactement ce que faisait le logout avant ce lot.
export async function supprimerConnexionGoogle(identiteSub: string): Promise<void> {
  await getDb().delete(connexionsGoogle).where(eq(connexionsGoogle.identiteSub, identiteSub));
}
