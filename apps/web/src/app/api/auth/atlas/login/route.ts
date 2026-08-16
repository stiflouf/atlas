import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { construireUrlAutorisationIdentite } from "@/lib/auth/googleIdentite";
import { ecrireStateOidcAtlas } from "@/lib/auth/atlasOidcState";

// Publique par nature (ADR-047, voir src/proxy.ts) : c'est ce point d'entrée qui permet d'obtenir
// une session Atlas — la gater derrière une session Atlas serait circulaire. Distincte de
// /api/auth/google/login (autorisation Calendar) et /api/auth/google/gmail/login (autorisation
// Gmail), qui exigent désormais toutes deux une session Atlas déjà établie.
export async function GET() {
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  await ecrireStateOidcAtlas(state, nonce);
  return NextResponse.redirect(construireUrlAutorisationIdentite(state, nonce));
}
