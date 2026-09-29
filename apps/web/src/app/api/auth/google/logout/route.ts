import { NextResponse } from "next/server";
import { revoquerToken } from "@/lib/google/oauth";
import { lireConnexionGoogle, supprimerConnexionGoogle } from "@/lib/google/connexion";
import { exigerSessionAtlasRoute } from "@/lib/auth/exigerSessionAtlasRoute";

// POST plutôt que GET : cette route mute l'état (révocation + suppression en base), elle ne
// doit pas pouvoir être déclenchée par un simple lien ou un prefetch. ADR-047 : anonyme → aucune
// révocation, aucune suppression de connexion_google — seul un conseiller déjà connecté à Atlas
// peut priver l'instance de son propre accès Calendar/Gmail.
export async function POST(request: Request) {
  // WORKSPACE_SCOPING_V2D2 — se déconnecter ne déconnecte plus que SOI. Avant ce lot, cette route
  // révoquait l'unique token de l'instance et supprimait l'unique ligne : le premier qui cliquait
  // « Déconnecter » coupait l'accès Calendar et Gmail de tous les autres, sans le savoir.
  const { refus, session } = await exigerSessionAtlasRoute();
  if (refus) return refus;
  const connexion = await lireConnexionGoogle(session.sub);
  if (connexion?.refreshToken) {
    await revoquerToken(connexion.refreshToken);
  }
  await supprimerConnexionGoogle(session.sub);
  return NextResponse.redirect(new URL("/", request.url));
}
