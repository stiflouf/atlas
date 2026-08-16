import { cookies } from "next/headers";

const COOKIE_STATE_OIDC = "atlas_oidc_state";

// Cookie de très courte durée, le temps de l'aller-retour vers Google — même patron que
// src/lib/google/state.ts (state OAuth métier Calendar/Gmail), mais strictement distinct : ce
// cookie protège le flux d'identité Atlas (ADR-047), jamais le flux d'autorisation Calendar/Gmail.
// state (anti-CSRF) et nonce (anti-replay de l'id_token) voyagent ensemble, un seul cookie,
// jamais persistés au-delà de cet aller-retour.
type ChargeOidcAtlas = { state: string; nonce: string };

export async function ecrireStateOidcAtlas(state: string, nonce: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_STATE_OIDC, JSON.stringify({ state, nonce } satisfies ChargeOidcAtlas), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

// Usage unique : supprimé dès la lecture, qu'elle réussisse ou non — un state ne peut jamais être
// consommé deux fois.
export async function lireEtSupprimerStateOidcAtlas(): Promise<ChargeOidcAtlas | undefined> {
  const cookieStore = await cookies();
  const brut = cookieStore.get(COOKIE_STATE_OIDC)?.value;
  cookieStore.delete(COOKIE_STATE_OIDC);
  if (!brut) return undefined;
  try {
    const valeur = JSON.parse(brut) as Partial<ChargeOidcAtlas>;
    if (typeof valeur.state !== "string" || typeof valeur.nonce !== "string") return undefined;
    return { state: valeur.state, nonce: valeur.nonce };
  } catch {
    return undefined;
  }
}
