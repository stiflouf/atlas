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

  // Usage unique : consommé ici quoi qu'il arrive, y compris si la suite refuse. Un state rejoué
  // ne retrouve donc jamais de cookie, et le second passage est refusé comme un state absent.
  const chargeState = await lireEtSupprimerStateTemporaire();
  const sessionAtlas = await lireSessionAtlas();

  if (!sessionAtlas) {
    return NextResponse.redirect(new URL("/connexion?erreur=connexion_echouee", origine));
  }

  if (erreur || !code || !state || !chargeState || state !== chargeState.state) {
    return NextResponse.redirect(new URL("/?google=erreur", origine));
  }

  // WORKSPACE_SCOPING_V2D2 — TROISIÈME garantie, indépendante des deux précédentes : la personne
  // qui revient doit être celle qui est partie. Le state prouve que la réponse appartient au flux
  // lancé par CE navigateur ; la session prouve que quelqu'un d'autorisé est présent. Aucune des
  // deux ne prouve que c'est la MÊME personne — et si la session a changé entre-temps (déconnexion
  // puis reconnexion sous un autre compte pendant le consentement Google), le refresh token accordé
  // par A serait écrit sous l'identité de B, qui hériterait silencieusement de son agenda et de sa
  // boîte Gmail. Refus, et le token n'est même pas demandé à Google.
  if (chargeState.identiteSub !== sessionAtlas.sub) {
    return NextResponse.redirect(new URL("/?google=erreur", origine));
  }

  try {
    const tokens = await echangerCodeContreTokens(code);
    await ecrireConnexionGoogle(sessionAtlas.sub, tokens.refreshToken, tokens.scope);
  } catch (e) {
    // Ne jamais logger l'objet erreur complet (correction n°10, passe de fermeture ADR-047) : une
    // erreur d'échange de code OAuth peut porter des propriétés enrichies (réponse HTTP externe,
    // URL, métadonnées) au-delà de `.message` — jamais code OAuth, refresh_token, cookie, state.
    console.error("[google-calendar] échec de l'échange de code OAuth :", e instanceof Error ? e.message : "erreur non standard");
    return NextResponse.redirect(new URL("/?google=erreur", origine));
  }

  return NextResponse.redirect(new URL("/", origine));
}
