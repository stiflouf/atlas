import { NextResponse } from "next/server";
import { echangerCodeEtVerifierIdentite } from "@/lib/auth/googleIdentite";
import { lireEtSupprimerStateOidcAtlas } from "@/lib/auth/atlasOidcState";
import { estEmailAutorise } from "@/lib/auth/allowlist";
import { creerSessionAtlas } from "@/lib/auth/sessionAtlas";

// Publique par nature (ADR-047, voir src/proxy.ts) : c'est Google qui redirige le navigateur ici,
// avant qu'aucune session Atlas n'existe. La garantie ne vient pas d'une session préalable mais du
// couple state/nonce à usage unique (cookie httpOnly) vérifié ci-dessous, puis de la validation
// cryptographique de l'id_token (google-auth-library, jamais un décodage JWT non vérifié), puis de
// l'allowlist mono-conseiller. Aucun id_token/access_token n'est jamais persisté au-delà de cette
// fonction (voir googleIdentite.ts) — seule la session Atlas minimale (sub, email) survit.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRecu = url.searchParams.get("state");
  const erreurGoogle = url.searchParams.get("error");

  const chargeAttendue = await lireEtSupprimerStateOidcAtlas();

  if (erreurGoogle || !code || !stateRecu || !chargeAttendue || stateRecu !== chargeAttendue.state) {
    return NextResponse.redirect(new URL("/connexion?erreur=connexion_echouee", url.origin));
  }

  try {
    const identite = await echangerCodeEtVerifierIdentite(code, chargeAttendue.nonce);

    if (!estEmailAutorise(identite.email)) {
      // Réponse honnête sans révéler l'adresse attendue (ADR-047, correction n°10 de l'audit).
      return NextResponse.redirect(new URL("/connexion?erreur=compte_non_autorise", url.origin));
    }

    await creerSessionAtlas({ sub: identite.sub, email: identite.email });
  } catch (e) {
    // Ne jamais logger l'objet erreur complet (correction n°10, passe de fermeture ADR-047) : une
    // erreur venant de google-auth-library ou de l'échange de code peut porter des propriétés
    // enrichies (réponse HTTP externe, URL, métadonnées) au-delà de `.message` — jamais id_token,
    // access_token, code, cookie, session, state, nonce, Authorization ou secret.
    console.error("[atlas-auth] échec de la vérification d'identité Google :", e instanceof Error ? e.message : "erreur non standard");
    return NextResponse.redirect(new URL("/connexion?erreur=connexion_echouee", url.origin));
  }

  return NextResponse.redirect(new URL("/", url.origin));
}
