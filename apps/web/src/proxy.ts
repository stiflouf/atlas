import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { optionsSessionAtlas, type DonneesSessionAtlas } from "@/lib/auth/sessionAtlas";

// PRIVATE BY DEFAULT (ADR-047) : toute page/route exige une session Atlas valide, sauf les
// exceptions explicites ci-dessous. Convention Next.js 16 : `middleware.ts` est déprécié et
// renommé `proxy.ts` (voir node_modules/next/dist/docs/.../file-conventions/proxy.md).
//
// Le Proxy filtre la navigation/les requêtes de premier niveau — il ne protège JAMAIS les Server
// Actions à lui seul (la documentation Next.js elle-même le dit explicitement : "a Proxy matcher
// that excludes a path will also skip Server Function calls on that path"). La garantie réelle
// pour les mutations vit dans exigerSessionAtlas(), appelée en seconde couche à l'intérieur de
// chaque Server Action et de chaque Route Handler utilisateur.

// Page de connexion et flux d'identité Atlas : seuls points strictement publics, parce que ce sont
// eux qui permettent d'obtenir une session.
const CHEMINS_PUBLICS = new Set(["/connexion", "/api/auth/atlas/login", "/api/auth/atlas/callback"]);

// Endpoints machine (ADR-033/036/038) : jamais gérés par une session Atlas, humaine par nature — un
// cron externe doit pouvoir les atteindre sans navigateur. Les exclure du Proxy ne les rend jamais
// publics : leur Route Handler conserve son secret Bearer dédié, vérifié indépendamment (voir
// docs/adr/047-securisation-pilote-mono-conseiller.md).
const CHEMINS_TECHNIQUES = new Set([
  "/api/automatisations/scan",
  "/api/automatisations/reprise",
  "/api/compatibilite/scan",
  "/api/compatibilite/baseline",
]);

async function possedeSessionValide(request: NextRequest): Promise<boolean> {
  try {
    // `NextRequest.cookies` (RequestCookies, lecture) et l'interface CookieStore d'iron-session
    // (pensée aussi pour l'écriture réponse, `set(name, value, options?)`) divergent légèrement sur
    // l'arité exacte de `set` — jamais appelée ici, le Proxy ne fait QUE lire une session
    // existante, jamais en créer/modifier une (voir creerSessionAtlas/detruireSessionAtlas dans
    // sessionAtlas.ts, seuls points d'écriture réels, tous deux via next/headers.cookies() en
    // contexte Route Handler). Frontière de typage entre deux bibliothèques, jamais une frontière
    // de logique de sécurité — getIronSession() lit `cookies.get()`, seule opération réellement
    // exercée ici ; à l'exécution `request.cookies` expose bien get/set, le cast ne masque aucune
    // incompatibilité réelle.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await getIronSession<DonneesSessionAtlas>(request.cookies as any, optionsSessionAtlas());
    return Boolean(session.sub && session.email);
  } catch {
    // Configuration de session absente/invalide (ATLAS_SESSION_PASSWORD) : fail-closed, jamais
    // traité comme une session valide.
    return false;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (CHEMINS_PUBLICS.has(pathname) || CHEMINS_TECHNIQUES.has(pathname)) {
    return NextResponse.next();
  }

  if (await possedeSessionValide(request)) {
    return NextResponse.next();
  }

  // Réponse honnête selon la nature de la requête : une route API anonyme reçoit un refus
  // explicite (jamais une redirection HTML silencieuse vers /connexion), une page anonyme est
  // renvoyée vers l'écran de connexion.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ erreur: "Non authentifié." }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/connexion", request.url));
}

export const config = {
  // brand/ : assets statiques publics de marque (public/brand/*, PropertyVisual/sidebar) — jamais
  // de donnée métier, jamais besoin de session pour s'afficher (contrairement à
  // /api/photos-bien/[photoId], qui reste privé). Même famille d'exclusion que les chemins
  // d'infrastructure Next déjà exclus ci-dessous, pas une entrée de CHEMINS_PUBLICS (qui documente
  // les seuls points permettant d'obtenir une session, pas les assets statiques).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|brand/).*)"],
};
