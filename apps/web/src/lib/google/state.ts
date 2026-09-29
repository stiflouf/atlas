import { cookies } from "next/headers";

const STATE_COOKIE = "atlas_google_oauth_state";

// Cookie de très courte durée, le temps de l'aller-retour vers Google — protège contre le CSRF
// sur le flux OAuth. La valeur n'est pas secrète, seulement imprévisible et à usage unique.
//
// WORKSPACE_SCOPING_V2D2 — le state transporte désormais AUSSI le `sub` Atlas qui a initié le flux.
// Le state seul répondait « cette réponse vient bien du flux que ce navigateur a lancé » ; il ne
// répondait pas « et c'est bien la même personne qui revient ». Tant qu'une seule identité pouvait
// se connecter, les deux questions se confondaient. Avec plusieurs, elles divergent : si la session
// change entre le départ et le retour (déconnexion puis reconnexion sous un autre compte dans le
// même navigateur), le callback écrirait le token accordé par A sous l'identité de B.
//
// Même forme que `atlasOidcState.ts` (couple state/nonce du flux identitaire) : un seul cookie
// httpOnly portant un JSON, jamais un JWT — rien ici n'a besoin d'être vérifiable hors de ce
// serveur, et le cookie est déjà scellé par `httpOnly` + `secure`.
type ChargeStateGoogle = { state: string; identiteSub: string };

export async function ecrireStateTemporaire(state: string, identiteSub: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, JSON.stringify({ state, identiteSub } satisfies ChargeStateGoogle), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

// Usage unique : supprimé dès la lecture, qu'elle réussisse ou non — un state ne peut jamais être
// consommé deux fois. Un cookie au format hérité (chaîne nue, écrit avant ce lot et encore dans le
// navigateur au moment du déploiement) est traité comme ABSENT : il ne porte aucune identité, donc
// il ne peut pas prouver qui revient. Le flux est simplement à relancer.
export async function lireEtSupprimerStateTemporaire(): Promise<ChargeStateGoogle | undefined> {
  const cookieStore = await cookies();
  const brut = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  if (!brut) return undefined;
  try {
    const valeur = JSON.parse(brut) as Partial<ChargeStateGoogle>;
    if (typeof valeur.state !== "string" || typeof valeur.identiteSub !== "string") return undefined;
    return { state: valeur.state, identiteSub: valeur.identiteSub };
  } catch {
    return undefined;
  }
}
