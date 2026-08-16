import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { SCOPE_GMAIL_SEND, construireUrlAutorisation } from "@/lib/google/oauth";
import { ecrireStateTemporaire } from "@/lib/google/state";
import { exigerSessionAtlas } from "@/lib/auth/sessionAtlas";

// ADR-047 : un visiteur anonyme ne peut jamais initier une autorisation Gmail pour l'instance Atlas
// — même rationale que /api/auth/google/login.
//
// Autorisation incrémentale (ADR-031-bis) : ne demande QUE le scope Gmail — jamais Calendar en
// même temps, pour ne jamais créer de dépendance conceptuelle Gmail -> Calendar dans ce code.
// `include_granted_scopes=true` (toujours actif dans construireUrlAutorisation) laisse Google
// plier le scope Calendar déjà accordé, le cas échéant, dans le nouveau refresh_token — Atlas ne
// le suppose jamais, il relit ensuite le `scope` réellement retourné (voir callback + capacites.ts).
// `prompt=consent` est toujours forcé ici (jamais conditionnel comme pour Calendar) : un
// refresh_token est requis à coup sûr pour cette nouvelle capacité, et Google ne le réémet de
// façon garantie qu'avec un consentement explicite.
export async function GET() {
  await exigerSessionAtlas();
  const state = randomBytes(16).toString("hex");
  await ecrireStateTemporaire(state);
  return NextResponse.redirect(construireUrlAutorisation(state, true, [SCOPE_GMAIL_SEND]));
}
