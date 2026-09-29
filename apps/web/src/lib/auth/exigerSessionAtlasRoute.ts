import { NextResponse } from "next/server";
import { lireSessionAtlas, type DonneesSessionAtlas } from "./sessionAtlas";

// Équivalent Route Handler de exigerSessionAtlas() (utilisée par les Server Actions, inchangée).
// exigerSessionAtlas() lève une Error brute : sans traitement dédié, une exception non capturée
// dans un Route Handler produit un 500 générique — techniquement sans fuite (le Proxy intercepte
// déjà tout accès anonyme à ces routes en amont), mais la seconde couche doit rester propre
// indépendamment du Proxy. Renvoie une réponse 401 JSON prête à retourner si la session Atlas est
// absente, sinon `null` — corps identique à celui déjà produit par src/proxy.ts pour rester
// cohérent côté client, quel que soit le point qui a intercepté la requête.
export async function refuserSiSessionAtlasAbsente(): Promise<NextResponse | null> {
  const session = await lireSessionAtlas();
  if (session) return null;
  return NextResponse.json({ erreur: "Non authentifié." }, { status: 401 });
}

// WORKSPACE_SCOPING_V2D2 — variante qui REND l'identité au lieu de se contenter de la vérifier.
// `refuserSiSessionAtlasAbsente` ci-dessus répond « quelqu'un est entré » ; les routes Google ont
// désormais besoin de savoir QUI, pour rattacher (ou retrouver, ou supprimer) la bonne connexion.
// Une seule lecture de session, un seul point de décision : ni duplication de la garde, ni second
// déchiffrement de cookie dans l'appelant.
//
// Discriminant sur `refus` plutôt que sur `session` : un `null` de session et un `null` de refus ne
// doivent pas pouvoir être confondus par l'appelant.
export async function exigerSessionAtlasRoute(): Promise<
  { refus: NextResponse; session?: undefined } | { refus?: undefined; session: DonneesSessionAtlas }
> {
  const session = await lireSessionAtlas();
  if (!session) return { refus: NextResponse.json({ erreur: "Non authentifié." }, { status: 401 }) };
  return { session };
}
