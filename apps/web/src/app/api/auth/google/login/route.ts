import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { SCOPE_CALENDAR_READONLY, construireUrlAutorisation } from "@/lib/google/oauth";
import { ecrireStateTemporaire } from "@/lib/google/state";
import { lireConnexionGoogle } from "@/lib/google/connexion";
import { refuserSiSessionAtlasAbsente } from "@/lib/auth/exigerSessionAtlasRoute";

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
  const refus = await refuserSiSessionAtlasAbsente();
  if (refus) return refus;
  const url = new URL(request.url);
  const reconnexionExplicite = url.searchParams.get("reconnexion") === "1";
  const dejaConnecte = Boolean(await lireConnexionGoogle());

  const state = randomBytes(16).toString("hex");
  await ecrireStateTemporaire(state);

  const forcerConsentement = reconnexionExplicite || !dejaConnecte;
  // Calendar seul — jamais couplé à Gmail ici (ADR-031-bis) : ce flux reste strictement inchangé
  // pour les utilisateurs n'ayant jamais autorisé Gmail.
  return NextResponse.redirect(construireUrlAutorisation(state, forcerConsentement, [SCOPE_CALENDAR_READONLY]));
}
