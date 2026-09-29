import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { SCOPE_CALENDAR_READONLY, construireUrlAutorisation } from "@/lib/google/oauth";
import { ecrireStateTemporaire } from "@/lib/google/state";
import { lireConnexionGoogle } from "@/lib/google/connexion";
import { exigerSessionAtlasRoute } from "@/lib/auth/exigerSessionAtlasRoute";

// ADR-047 : un visiteur anonyme ne peut jamais initier une autorisation Calendar pour l'instance
// Atlas — seul un conseiller déjà authentifié dans Atlas le peut. Distinct de l'authentification
// Atlas elle-même (/api/auth/atlas/login) : ce flux n'établit jamais de session Atlas, seulement
// une autorisation métier Google.
//
// Force le consentement Google (donc un nouveau refresh_token) uniquement :
// - lors d'une toute première connexion (aucune connexion en base) ;
// - lors d'une reconnexion explicite après échec (?reconnexion=1), typiquement quand le
//   refresh_token stocké a été révoqué et n'est plus utilisable.
export async function GET(request: Request) {
  // WORKSPACE_SCOPING_V2D2 — la session n'est plus seulement vérifiée, elle est LUE : son `sub`
  // détermine la connexion à consulter, et il est scellé dans le state pour que le callback puisse
  // vérifier que c'est bien la même personne qui revient.
  const { refus, session } = await exigerSessionAtlasRoute();
  if (refus) return refus;
  const url = new URL(request.url);
  const reconnexionExplicite = url.searchParams.get("reconnexion") === "1";
  // « Déjà connecté » est désormais une question PERSONNELLE : la connexion d'un collègue ne doit
  // pas faire sauter le consentement de celui qui arrive (il n'obtiendrait alors aucun
  // refresh_token, et sa propre connexion resterait impossible).
  const dejaConnecte = Boolean(await lireConnexionGoogle(session.sub));

  const state = randomBytes(16).toString("hex");
  await ecrireStateTemporaire(state, session.sub);

  const forcerConsentement = reconnexionExplicite || !dejaConnecte;
  // Calendar seul — jamais couplé à Gmail ici (ADR-031-bis) : ce flux reste strictement inchangé
  // pour les utilisateurs n'ayant jamais autorisé Gmail.
  return NextResponse.redirect(construireUrlAutorisation(state, forcerConsentement, [SCOPE_CALENDAR_READONLY]));
}
