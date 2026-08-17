import { NextResponse } from "next/server";
import { lireSessionAtlas } from "./sessionAtlas";

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
