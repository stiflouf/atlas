// Injection d'une VRAIE session Atlas valide dans le navigateur Playwright — sans passer par
// l'écran Google interactif et sans aucune backdoor applicative (audit V1 Candidate, §21-§23).
// Utilise sealData(), la primitive de scellement réelle d'iron-session, avec exactement les mêmes
// options que src/lib/auth/sessionAtlas.ts::optionsSessionAtlas() — le cookie produit est donc
// indiscernable, pour le Proxy et pour exigerSessionAtlas(), d'une session issue du vrai flux
// OAuth. Le test prouve ensuite explicitement que l'absence de ce cookie renvoie /connexion : la
// session n'est jamais contournée, seulement pré-scellée.
import type { BrowserContext } from "@playwright/test";
import { sealData } from "iron-session";
import { optionsSessionAtlas } from "../src/lib/auth/sessionAtlas";
import { EMAIL_E2E, SESSION_PASSWORD_E2E } from "./env";

// Réutilise directement optionsSessionAtlas() (cookieName/ttl/cookieOptions) plutôt que de les
// dupliquer ici — garantit que ce cookie reste indiscernable, pour le Proxy et pour
// exigerSessionAtlas(), d'une session issue du vrai flux OAuth, y compris si ces options évoluent.
export async function injecterSessionAtlasValide(context: BrowserContext, baseURL: string): Promise<void> {
  process.env.ATLAS_SESSION_PASSWORD = SESSION_PASSWORD_E2E;
  const options = optionsSessionAtlas();
  const valeur = await sealData({ sub: "e2e-conseiller", email: EMAIL_E2E }, { password: options.password, ttl: options.ttl });
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: options.cookieName,
      value: valeur,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: options.cookieOptions?.secure ?? false,
    },
  ]);
}
