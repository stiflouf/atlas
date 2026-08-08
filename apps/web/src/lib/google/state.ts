import { cookies } from "next/headers";

const STATE_COOKIE = "atlas_google_oauth_state";

// Cookie de très courte durée, le temps de l'aller-retour vers Google — protège contre le CSRF
// sur le flux OAuth. La valeur n'est pas secrète, seulement imprévisible et à usage unique.
export async function ecrireStateTemporaire(state: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

export async function lireEtSupprimerStateTemporaire(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const valeur = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  return valeur;
}
