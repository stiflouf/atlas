import { NextResponse } from "next/server";
import { revoquerToken } from "@/lib/google/oauth";
import { lireConnexionGoogle, supprimerConnexionGoogle } from "@/lib/google/connexion";
import { refuserSiSessionAtlasAbsente } from "@/lib/auth/exigerSessionAtlasRoute";

// POST plutôt que GET : cette route mute l'état (révocation + suppression en base), elle ne
// doit pas pouvoir être déclenchée par un simple lien ou un prefetch. ADR-047 : anonyme → aucune
// révocation, aucune suppression de connexion_google — seul un conseiller déjà connecté à Atlas
// peut priver l'instance de son propre accès Calendar/Gmail.
export async function POST(request: Request) {
  const refus = await refuserSiSessionAtlasAbsente();
  if (refus) return refus;
  const connexion = await lireConnexionGoogle();
  if (connexion?.refreshToken) {
    await revoquerToken(connexion.refreshToken);
  }
  await supprimerConnexionGoogle();
  return NextResponse.redirect(new URL("/", request.url));
}
