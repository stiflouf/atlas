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

// SONDE DE DISPONIBILITÉ (PILOT_PRODUCTION_HARDENING_V1). Cinquième catégorie, et non un ajout
// dans l'une des précédentes : aucune ne la décrit honnêtement. `CHEMINS_PUBLICS` désigne les
// points qui permettent d'OBTENIR une session — /api/health n'en établit aucune ;
// `CHEMINS_TECHNIQUES` ceux dont la garde est un secret Bearer — /api/health n'en a pas, et ne peut
// pas en avoir : une sonde externe ou le healthcheck natif de la plateforme n'envoient ni cookie ni
// en-tête d'autorisation. La ranger dans une catégorie dont elle ne respecte pas le modèle de
// sécurité aurait rendu ce fichier menteur sur la seule question qu'il traite.
//
// Ce qui rend ce choix acceptable n'est pas le Proxy, c'est le CONTENU de la réponse : trois états
// UP/DOWN, aucun chemin, aucun nom d'hôte, aucun message système, aucune donnée métier (voir
// app/api/health/route.ts, dont la discipline est verrouillée par un test structurel). Si cette
// route devait un jour exposer un détail de diagnostic, elle devrait changer de catégorie d'abord.
const CHEMINS_SANTE = new Set(["/api/health"]);

// RETOUR D'AUTORISATION OAUTH MÉTIER (Calendar et Gmail partagent ce seul callback, via
// GOOGLE_REDIRECT_URI). C'est GOOGLE qui redirige le NAVIGATEUR ici : le Proxy ne peut donc pas être
// ce qui décide du sort de la requête, parce qu'il n'a aucun moyen de répondre quoi que ce soit
// d'utile à une personne qui revient d'un écran de consentement.
//
// Ni CHEMINS_PUBLICS, ni CHEMINS_TECHNIQUES, et ce n'est pas une nuance : CHEMINS_PUBLICS désigne
// les points qui permettent d'OBTENIR une session (ce callback n'en établit aucune), et
// CHEMINS_TECHNIQUES ceux dont la garde est un secret Bearer (ce callback n'en a pas). Son modèle
// de sécurité est un triplet, et il vit entièrement dans son Route Handler : state à usage unique
// (cookie httpOnly), session Atlas exigée, et égalité entre le `sub` scellé dans le state et celui
// de la session. Les trois sont conservés — voir api/auth/google/callback/route.ts et ses tests.
//
// Pourquoi laisser passer : intercepté ici, un retour sans session recevait un `401 {"erreur":
// "Non authentifié."}` en JSON brut. Aucune redirection vers /connexion, aucun log, et le handler
// n'avait jamais la main pour nommer la cause — l'échec était à la fois invisible côté serveur et
// inexploitable côté utilisateur (constat de production : connexions_google restait à 0 sans
// qu'aucune ligne de journal n'existe). Laisser passer ne retire aucun contrôle, cela les déplace
// là où ils peuvent produire une réponse honnête.
//
// Même raisonnement que /api/auth/atlas/callback, déjà public ci-dessus pour ce motif exact : un
// callback OAuth est un point d'entrée dont l'autorisation se prouve APRÈS, sur le contenu de la
// requête, jamais avant.
const CHEMINS_RETOUR_OAUTH_METIER = new Set(["/api/auth/google/callback"]);

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

  if (
    CHEMINS_PUBLICS.has(pathname) ||
    CHEMINS_TECHNIQUES.has(pathname) ||
    CHEMINS_SANTE.has(pathname) ||
    CHEMINS_RETOUR_OAUTH_METIER.has(pathname)
  ) {
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
