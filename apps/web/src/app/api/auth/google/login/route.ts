import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { construireUrlAutorisation } from "@/lib/google/oauth";
import { ecrireStateTemporaire } from "@/lib/google/state";
import { lireTokens } from "@/lib/google/tokens";

// Force le consentement Google (donc un nouveau refresh_token) uniquement :
// - lors d'une toute première connexion (aucun token stocké) ;
// - lors d'une reconnexion explicite après échec (?reconnexion=1), typiquement quand le
//   refresh_token stocké a été révoqué et n'est plus utilisable.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reconnexionExplicite = url.searchParams.get("reconnexion") === "1";
  const dejaConnecte = Boolean(await lireTokens());

  const state = randomBytes(16).toString("hex");
  await ecrireStateTemporaire(state);

  const forcerConsentement = reconnexionExplicite || !dejaConnecte;
  return NextResponse.redirect(construireUrlAutorisation(state, forcerConsentement));
}
