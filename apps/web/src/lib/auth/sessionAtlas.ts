import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";

// Session Atlas (ADR-047) — strictement distincte des connexions Google métier (Calendar/Gmail,
// voir src/lib/google/connexion.ts) : ne contient jamais d'access_token/refresh_token, seulement
// les deux faits nécessaires à l'identité ("qui est entré"), jamais "à quoi cette personne a accès
// chez Google".
export type DonneesSessionAtlas = { sub: string; email: string };

const NOM_COOKIE_SESSION = "atlas_session";
// 7 jours (ADR-047, décision explicite) : pas de "remember me" — une reconnexion Google après
// expiration est acceptable, aucune donnée métier n'est perdue, aucun mot de passe Atlas n'existe.
const DUREE_SESSION_SECONDES = 60 * 60 * 24 * 7;

// Fail-closed (ADR-047) : une variable manquante ou trop courte doit empêcher toute session d'être
// créée ou lue, jamais laisser Atlas s'ouvrir sans protection réelle. iron-session exige au moins
// 32 caractères pour la clé de scellement. Exportée (pas seulement interne) : src/proxy.ts en a
// besoin pour lire la session via l'API cookies de NextRequest, distincte de next/headers.
export function optionsSessionAtlas(): SessionOptions {
  const motDePasse = process.env.ATLAS_SESSION_PASSWORD;
  if (!motDePasse || motDePasse.length < 32) {
    throw new Error(
      "Configuration de session Atlas absente ou invalide : ATLAS_SESSION_PASSWORD doit être défini (32 caractères minimum)."
    );
  }
  return {
    cookieName: NOM_COOKIE_SESSION,
    password: motDePasse,
    ttl: DUREE_SESSION_SECONDES,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

async function obtenirSession(): Promise<IronSession<DonneesSessionAtlas>> {
  const cookieStore = await cookies();
  return getIronSession<DonneesSessionAtlas>(cookieStore, optionsSessionAtlas());
}

// Lecture tolérante — ne lève jamais pour une session absente/invalide/expirée (état normal, par
// exemple sur /connexion elle-même). Réservée aux points où l'absence de session doit être gérée
// explicitement par l'appelant plutôt que de faire échouer tout le rendu.
export async function lireSessionAtlas(): Promise<DonneesSessionAtlas | undefined> {
  const session = await obtenirSession();
  if (!session.sub || !session.email) return undefined;
  return { sub: session.sub, email: session.email };
}

// Garde fail-closed (ADR-047) — à appeler en première ligne de CHAQUE Server Action et de CHAQUE
// Route Handler utilisateur, avant tout accès DB/Google/effet. Lève systématiquement en l'absence
// de session valide : jamais de dégradation silencieuse vers un comportement anonyme partiel. Le
// Proxy (src/proxy.ts) filtre déjà la navigation en amont, mais ne protège jamais les Server
// Actions (voir data-security.md de Next.js) — cette fonction est la source de vérité au point
// d'action, indépendamment du Proxy.
export async function exigerSessionAtlas(): Promise<DonneesSessionAtlas> {
  const donnees = await lireSessionAtlas();
  if (!donnees) throw new Error("Non authentifié.");
  return donnees;
}

// Réservée au callback identitaire (src/app/api/auth/atlas/callback/route.ts), seul point du code
// qui crée une session — jamais appelée ailleurs.
export async function creerSessionAtlas(donnees: DonneesSessionAtlas): Promise<void> {
  const session = await obtenirSession();
  session.sub = donnees.sub;
  session.email = donnees.email;
  await session.save();
}

export async function detruireSessionAtlas(): Promise<void> {
  const session = await obtenirSession();
  session.destroy();
}
