import { NextResponse } from "next/server";
import { revoquerToken } from "@/lib/google/oauth";
import { lireTokens, supprimerTokens } from "@/lib/google/tokens";

// POST plutôt que GET : cette route mute l'état (révocation + suppression de cookie),
// elle ne doit pas pouvoir être déclenchée par un simple lien ou un prefetch.
export async function POST(request: Request) {
  const tokens = await lireTokens();
  if (tokens?.refreshToken) {
    await revoquerToken(tokens.refreshToken);
  }
  await supprimerTokens();
  return NextResponse.redirect(new URL("/", request.url));
}
