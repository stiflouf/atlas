import { NextResponse } from "next/server";
import { echangerCodeContreTokens } from "@/lib/google/oauth";
import { lireEtSupprimerStateTemporaire } from "@/lib/google/state";
import { ecrireConnexionGoogle } from "@/lib/google/connexion";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const erreur = url.searchParams.get("error");

  const stateAttendu = await lireEtSupprimerStateTemporaire();

  if (erreur || !code || !state || state !== stateAttendu) {
    return NextResponse.redirect(new URL("/?google=erreur", url.origin));
  }

  try {
    const tokens = await echangerCodeContreTokens(code);
    await ecrireConnexionGoogle(tokens.refreshToken, tokens.scope);
  } catch (e) {
    console.error("[google-calendar] échec de l'échange de code OAuth :", e);
    return NextResponse.redirect(new URL("/?google=erreur", url.origin));
  }

  return NextResponse.redirect(new URL("/", url.origin));
}
