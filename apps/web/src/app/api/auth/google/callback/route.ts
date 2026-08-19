import { NextResponse } from "next/server";
import { echangerCodeContreTokens, origineMetierPublique } from "@/lib/google/oauth";
import { lireEtSupprimerStateTemporaire } from "@/lib/google/state";
import { ecrireConnexionGoogle } from "@/lib/google/connexion";
import { lireSessionAtlas } from "@/lib/auth/sessionAtlas";

// ADR-047, correction n°15 de l'audit : ce callback appartient aux autorisations Google MÉTIER
// (Calendar/Gmail), initiées uniquement par un conseiller déjà connecté à Atlas (login/gmail-login
// exigent désormais exigerSessionAtlas()). Il exige donc lui aussi une session Atlas valide, en plus
// du state OAuth métier déjà vérifié ci-dessous — deux garanties indépendantes. Le cookie de
// session Atlas (SameSite=Lax) est envoyé par le navigateur sur cette redirection GET top-level
// depuis accounts.google.com : Lax autorise explicitement les navigations top-level en GET
// cross-site, ce cas précis. Session absente ici (ex. session expirée pendant le consentement
// Google) → refus explicite, jamais une connexion Google silencieusement acceptée sans conseiller
// identifié.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origine = origineMetierPublique();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const erreur = url.searchParams.get("error");

  const stateAttendu = await lireEtSupprimerStateTemporaire();
  const sessionAtlas = await lireSessionAtlas();

  if (!sessionAtlas) {
    return NextResponse.redirect(new URL("/connexion?erreur=connexion_echouee", origine));
  }

  if (erreur || !code || !state || state !== stateAttendu) {
    return NextResponse.redirect(new URL("/?google=erreur", origine));
  }

  try {
    const tokens = await echangerCodeContreTokens(code);
    await ecrireConnexionGoogle(tokens.refreshToken, tokens.scope);
  } catch (e) {
    // Ne jamais logger l'objet erreur complet (correction n°10, passe de fermeture ADR-047) : une
    // erreur d'échange de code OAuth peut porter des propriétés enrichies (réponse HTTP externe,
    // URL, métadonnées) au-delà de `.message` — jamais code OAuth, refresh_token, cookie, state.
    console.error("[google-calendar] échec de l'échange de code OAuth :", e instanceof Error ? e.message : "erreur non standard");
    return NextResponse.redirect(new URL("/?google=erreur", origine));
  }

  return NextResponse.redirect(new URL("/", origine));
}
