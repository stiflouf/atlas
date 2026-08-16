import { NextResponse } from "next/server";
import { detruireSessionAtlas } from "@/lib/auth/sessionAtlas";

// POST plutôt que GET : mute l'état (détruit la session), ne doit pas pouvoir être déclenchée par
// un simple lien ou un prefetch — même rationale que /api/auth/google/logout. Détruit uniquement la
// session Atlas : ne touche jamais aux connexions Google métier (Calendar/Gmail), qui restent
// disponibles à la prochaine connexion Atlas (ADR-047).
export async function POST(request: Request) {
  await detruireSessionAtlas();
  return NextResponse.redirect(new URL("/connexion", request.url));
}
