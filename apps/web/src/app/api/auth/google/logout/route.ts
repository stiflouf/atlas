import { NextResponse } from "next/server";
import { revoquerToken } from "@/lib/google/oauth";
import { lireConnexionGoogle, supprimerConnexionGoogle } from "@/lib/google/connexion";

// POST plutôt que GET : cette route mute l'état (révocation + suppression en base), elle ne
// doit pas pouvoir être déclenchée par un simple lien ou un prefetch.
export async function POST(request: Request) {
  const connexion = await lireConnexionGoogle();
  if (connexion?.refreshToken) {
    await revoquerToken(connexion.refreshToken);
  }
  await supprimerConnexionGoogle();
  return NextResponse.redirect(new URL("/", request.url));
}
